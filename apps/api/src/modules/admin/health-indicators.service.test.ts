import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { HealthIndicatorsService } from "./health-indicators.service.js";

/** CDC §39.3 — indicateurs de santé back-office, un comptage direct par indicateur. */
describe("HealthIndicatorsService", () => {
  const prisma = new PrismaClient();
  let courtId: string;
  let userId: string;

  beforeAll(async () => {
    resetConfigCacheForTests();
    const court = await prisma.court.upsert({
      where: { slug: "test-padel-health" },
      update: {},
      create: { slug: "test-padel-health", name: "Test Padel Health", courtType: "DOUBLE", capacity: 4, displayOrder: 93 },
    });
    courtId = court.id;
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.court.delete({ where: { id: courtId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const user = await prisma.user.create({
      data: { email: `health-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "H", lastName: "I", status: "ACTIVE" },
    });
    userId = user.id;
  });

  it("reports zero indicators against a clean database", async () => {
    const service = new HealthIndicatorsService(prisma, loadConfig());
    const result = await service.compute();

    expect(result.legacySyncErrors).toBe(0);
    expect(result.bookingsManualReview).toBe(0);
    expect(result.paymentsFailed).toBe(0);
    expect(result.walletHoldsStale).toBe(0);
    expect(result.creditPacksPaidNotCredited).toBe(0);
    expect(result.kioskDevicesOffline).toBe(0);
    expect(result.terminalDevicesUnavailable).toBe(0);
    expect(result.accessGrantsFailed).toBe(0);
    expect(result.notificationsFailed).toBe(0);
    expect(result.lastLegacySyncAt).toBeNull();
  });

  it("counts a booking in MANUAL_REVIEW and a failed payment", async () => {
    await prisma.booking.create({
      data: {
        organizer: { connect: { id: userId } },
        court: { connect: { id: courtId } },
        startAt: new Date(Date.now() + 3600_000),
        endAt: new Date(Date.now() + 7200_000),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "MANUAL_REVIEW",
      },
    });
    await prisma.payment.create({
      data: {
        user: { connect: { id: userId } },
        provider: "stripe",
        providerPaymentId: `pi_health_${Date.now()}`,
        amountCents: 4800,
        purpose: "BOOKING_FULL",
        status: "FAILED",
      },
    });

    const service = new HealthIndicatorsService(prisma, loadConfig());
    const result = await service.compute();
    expect(result.bookingsManualReview).toBe(1);
    expect(result.paymentsFailed).toBe(1);
  });

  it("counts a stale ACTIVE wallet hold but not a fresh one", async () => {
    const wallet = await prisma.walletAccount.create({ data: { userId } });
    await prisma.walletHold.create({
      data: { walletAccountId: wallet.id, amountCents: 1000, status: "ACTIVE", createdAt: new Date(Date.now() - 48 * 3600_000) },
    });
    await prisma.walletHold.create({
      data: { walletAccountId: wallet.id, amountCents: 1000, status: "ACTIVE", createdAt: new Date() },
    });

    const service = new HealthIndicatorsService(prisma, loadConfig());
    const result = await service.compute();
    expect(result.walletHoldsStale).toBe(1);
  });

  it("counts a credit pack purchase stuck at PAID (not yet CREDITED)", async () => {
    const pack = await prisma.creditPack.create({
      data: { name: "Pack santé", purchaseAmountCents: 1000, paidCreditsCents: 1000, salesChannels: ["ONLINE"], displayOrder: 1 },
    });
    await prisma.creditPackPurchase.create({
      data: { creditPack: { connect: { id: pack.id } }, user: { connect: { id: userId } }, purchaseAmountCents: 1000, paidCreditsCents: 1000, bonusCreditsCents: 0, status: "PAID" },
    });

    const service = new HealthIndicatorsService(prisma, loadConfig());
    const result = await service.compute();
    expect(result.creditPacksPaidNotCredited).toBe(1);
  });

  it("counts an offline kiosk device and an unavailable terminal device", async () => {
    await prisma.kioskDevice.create({
      data: { name: "Tablette hors ligne", deviceKeyHash: `hash-${Date.now()}`, capabilities: ["QR_HANDOFF"], status: "ACTIVE", lastSeenAt: new Date(Date.now() - 3600_000) },
    });
    await prisma.terminalDevice.create({
      data: { providerDeviceId: `tmr_${Date.now()}`, name: "Lecteur HS", capabilities: [], status: "OFFLINE" },
    });

    const service = new HealthIndicatorsService(prisma, loadConfig());
    const result = await service.compute();
    expect(result.kioskDevicesOffline).toBe(1);
    expect(result.terminalDevicesUnavailable).toBe(1);
  });

  it("counts FAILED access grants and FAILED notifications, and reports the most recent Legacy sync", async () => {
    const booking = await prisma.booking.create({
      data: {
        organizer: { connect: { id: userId } },
        court: { connect: { id: courtId } },
        startAt: new Date(Date.now() + 3600_000),
        endAt: new Date(Date.now() + 7200_000),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
      },
    });
    await prisma.accessGrant.create({
      data: {
        booking: { connect: { id: booking.id } },
        codeCiphertext: "x",
        codeIv: "y",
        origin: "V2_GENERATED",
        scope: courtId,
        status: "FAILED",
        validFrom: new Date(),
        validUntil: new Date(),
      },
    });
    await prisma.notificationOutbox.create({ data: { template: "BOOKING_CONFIRMATION", recipientUserId: userId, payload: {}, status: "FAILED", attempts: 5 } });
    const syncAt = new Date(Date.now() - 60_000);
    await prisma.legacyBookingMapping.create({ data: { bookingId: booking.id, correlationMarker: `APV2:${booking.id}`, syncStatus: "CONFIRMED", lastSyncAt: syncAt } });

    const service = new HealthIndicatorsService(prisma, loadConfig());
    const result = await service.compute();
    expect(result.accessGrantsFailed).toBe(1);
    expect(result.notificationsFailed).toBe(1);
    expect(result.lastLegacySyncAt?.getTime()).toBe(syncAt.getTime());
  });
});
