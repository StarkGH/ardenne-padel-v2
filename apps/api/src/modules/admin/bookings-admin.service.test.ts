import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, type Booking } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { buildTestAccessGrantService } from "../../testing/build-access-grant-service.js";
import { buildTestNotificationService } from "../../testing/build-notification-service.js";
import { BookingsRepository } from "../bookings/bookings.repository.js";
import { FakeLegacyProvider } from "../legacy-doinsport/testing/fake-legacy-provider.js";
import { AuditLogRepository } from "./audit-log.repository.js";
import { AuditLogService } from "./audit-log.service.js";
import { BookingsAdminService } from "./bookings-admin.service.js";

/**
 * CDC §39.1-§39.2 — dashboard planning et actions rapides admin (annuler,
 * forcer resync), avec bypass délibéré des garde-fous côté client
 * (organisateur/délai), toujours audité en contrepartie.
 */
describe("BookingsAdminService", () => {
  const prisma = new PrismaClient();
  let courtId: string;
  let organizerUserId: string;
  let actorUserId: string;

  beforeAll(async () => {
    resetConfigCacheForTests();
    const court = await prisma.court.upsert({
      where: { slug: "test-padel-bookings-admin" },
      update: {},
      create: { slug: "test-padel-bookings-admin", name: "Test Padel Bookings Admin", courtType: "DOUBLE", capacity: 4, displayOrder: 94 },
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
    const organizer = await prisma.user.create({
      data: { email: `booking-admin-org-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "O", lastName: "R", status: "ACTIVE" },
    });
    organizerUserId = organizer.id;
    const actor = await prisma.user.create({
      data: { email: `booking-admin-actor-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "S", lastName: "T", status: "ACTIVE", role: "ADMIN" },
    });
    actorUserId = actor.id;
  });

  function buildService(config = loadConfig()) {
    return new BookingsAdminService(
      new BookingsRepository(prisma),
      new FakeLegacyProvider(),
      config,
      buildTestAccessGrantService(prisma, config),
      buildTestNotificationService(prisma),
      new AuditLogService(new AuditLogRepository(prisma)),
    );
  }

  async function createConfirmedBooking(hourFromNow = 48): Promise<Booking> {
    const start = new Date(Date.now() + hourFromNow * 3600_000);
    const end = new Date(start.getTime() + 3600_000);
    return prisma.booking.create({
      data: {
        organizer: { connect: { id: organizerUserId } },
        court: { connect: { id: courtId } },
        startAt: start,
        endAt: end,
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "CONFIRMED",
        confirmedAt: new Date(),
        // Délai d'annulation client déjà dépassé : un `BookingsService.cancelBooking`
        // classique refuserait ; l'admin doit pouvoir passer outre.
        cancellationDeadline: new Date(Date.now() - 3600_000),
      },
    });
  }

  it("lists bookings within a date range for the planning dashboard", async () => {
    const booking = await createConfirmedBooking(24);
    const service = buildService();

    const results = await service.listForDashboard(new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 72 * 3600_000).toISOString());

    expect(results.some((b) => b.id === booking.id)).toBe(true);
  });

  it("cancels a confirmed booking past its client-facing cancellation deadline, auditing the override", async () => {
    const booking = await createConfirmedBooking();
    const service = buildService();

    const canceled = await service.adminCancel(booking.id, actorUserId, "client injoignable, terrain libéré par le club");
    expect(canceled!.status).toBe("CANCELED");

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "Booking", targetId: booking.id });
    expect(entries.some((e) => e.action === "BOOKING_ADMIN_CANCELED")).toBe(true);
  });

  it("rejects canceling a booking that is not CONFIRMED", async () => {
    const booking = await prisma.booking.create({
      data: {
        organizer: { connect: { id: organizerUserId } },
        court: { connect: { id: courtId } },
        startAt: new Date(Date.now() + 3600_000),
        endAt: new Date(Date.now() + 7200_000),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "CHECKOUT_PENDING",
      },
    });
    const service = buildService();
    await expect(service.adminCancel(booking.id, actorUserId, "raison")).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("marks a booking's Legacy mapping for resync, auditing before/after", async () => {
    const booking = await createConfirmedBooking();
    await prisma.legacyBookingMapping.create({
      data: { bookingId: booking.id, correlationMarker: `APV2:${booking.id}`, syncStatus: "FAILED", lastError: "timeout Doinsport" },
    });
    const service = buildService();

    const resynced = await service.forceResync(booking.id, actorUserId, "retenté après incident réseau");
    expect(resynced.syncStatus).toBe("PENDING");
    expect(resynced.lastError).toBeNull();

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "Booking", targetId: booking.id });
    expect(entries.some((e) => e.action === "BOOKING_FORCE_RESYNC")).toBe(true);
  });

  it("rejects force-resync for a booking without a Legacy mapping", async () => {
    const booking = await createConfirmedBooking();
    const service = buildService();
    await expect(service.forceResync(booking.id, actorUserId)).rejects.toMatchObject({ httpStatus: 409 });
  });
});
