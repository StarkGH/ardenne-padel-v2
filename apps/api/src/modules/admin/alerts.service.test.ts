import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { AlertsService } from "./alerts.service.js";
import { HealthIndicatorsService } from "./health-indicators.service.js";

/** CDC §57.4 — détection d'incohérences entre tables qui ne devraient jamais diverger. */
describe("AlertsService", () => {
  const prisma = new PrismaClient();
  let courtId: string;
  let userId: string;

  beforeAll(async () => {
    resetConfigCacheForTests();
    const court = await prisma.court.upsert({
      where: { slug: "test-padel-alerts" },
      update: {},
      create: { slug: "test-padel-alerts", name: "Test Padel Alerts", courtType: "DOUBLE", capacity: 4, displayOrder: 92 },
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
      data: { email: `alerts-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "A", lastName: "L", status: "ACTIVE" },
    });
    userId = user.id;
  });

  function buildService() {
    const config = loadConfig();
    return new AlertsService(prisma, config, new HealthIndicatorsService(prisma, config));
  }

  it("reports no alerts against a clean database", async () => {
    const service = buildService();
    expect(await service.compute()).toEqual([]);
  });

  it("flags a captured payment whose booking never reached CONFIRMED", async () => {
    const booking = await prisma.booking.create({
      data: {
        organizer: { connect: { id: userId } },
        court: { connect: { id: courtId } },
        startAt: new Date(Date.now() + 3600_000),
        endAt: new Date(Date.now() + 7200_000),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "FAILED",
      },
    });
    await prisma.payment.create({
      data: {
        booking: { connect: { id: booking.id } },
        user: { connect: { id: userId } },
        provider: "stripe",
        providerPaymentId: `pi_alert_${Date.now()}`,
        amountCents: 4800,
        purpose: "BOOKING_FULL",
        status: "SUCCEEDED",
      },
    });

    const alerts = await buildService().compute();
    const alert = alerts.find((a) => a.code === "PAYMENT_CAPTURED_WITHOUT_CONFIRMED_BOOKING");
    expect(alert).toBeTruthy();
    expect(alert!.count).toBe(1);
    expect(alert!.severity).toBe("critical");
  });

  it("flags a CONFIRMED FULL booking with no payment recorded", async () => {
    await prisma.booking.create({
      data: {
        organizer: { connect: { id: userId } },
        court: { connect: { id: courtId } },
        startAt: new Date(Date.now() + 3600_000),
        endAt: new Date(Date.now() + 7200_000),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "CONFIRMED",
        paymentMode: "FULL",
        paymentStatus: "NONE",
      },
    });

    const alerts = await buildService().compute();
    expect(alerts.some((a) => a.code === "BOOKING_CONFIRMED_WITHOUT_PAYMENT")).toBe(true);
  });

  it("flags an ACTIVE wallet hold left behind by a canceled booking", async () => {
    const booking = await prisma.booking.create({
      data: {
        organizer: { connect: { id: userId } },
        court: { connect: { id: courtId } },
        startAt: new Date(Date.now() + 3600_000),
        endAt: new Date(Date.now() + 7200_000),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "CANCELED",
        canceledAt: new Date(),
      },
    });
    const wallet = await prisma.walletAccount.create({ data: { userId } });
    await prisma.walletHold.create({ data: { walletAccountId: wallet.id, bookingId: booking.id, amountCents: 4800, status: "ACTIVE" } });

    const alerts = await buildService().compute();
    expect(alerts.some((a) => a.code === "WALLET_HOLD_NOT_RELEASED_AFTER_CANCELLATION")).toBe(true);
  });

  it("flags a confirmed booking starting soon with no access grant provisioned", async () => {
    await prisma.booking.create({
      data: {
        organizer: { connect: { id: userId } },
        court: { connect: { id: courtId } },
        startAt: new Date(Date.now() + 5 * 60_000),
        endAt: new Date(Date.now() + 65 * 60_000),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "CONFIRMED",
      },
    });

    const alerts = await buildService().compute();
    const alert = alerts.find((a) => a.code === "ACCESS_NOT_PROVISIONED_NEAR_START");
    expect(alert).toBeTruthy();
    expect(alert!.severity).toBe("warning");
  });

  it("does not flag a confirmed booking far in the future without an access grant", async () => {
    await prisma.booking.create({
      data: {
        organizer: { connect: { id: userId } },
        court: { connect: { id: courtId } },
        startAt: new Date(Date.now() + 30 * 24 * 3600_000),
        endAt: new Date(Date.now() + 30 * 24 * 3600_000 + 3600_000),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "CONFIRMED",
      },
    });

    const alerts = await buildService().compute();
    expect(alerts.some((a) => a.code === "ACCESS_NOT_PROVISIONED_NEAR_START")).toBe(false);
  });
});
