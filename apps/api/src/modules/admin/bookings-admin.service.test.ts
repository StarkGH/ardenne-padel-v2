import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, type Booking } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { buildTestAccessGrantService } from "../../testing/build-access-grant-service.js";
import { buildTestNotificationService } from "../../testing/build-notification-service.js";
import { BookingsRepository } from "../bookings/bookings.repository.js";
import { BookingsService } from "../bookings/bookings.service.js";
import { CourtsRepository } from "../courts/courts.repository.js";
import { PricingRepository } from "../pricing/pricing.repository.js";
import { PricingService } from "../pricing/pricing.service.js";
import { IdentityRepository } from "../identity/identity.repository.js";
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

    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.tariffRule.create({
      data: {
        name: "Tarif test bookings-admin",
        courtId,
        validFrom: new Date("2020-01-01"),
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "00:00",
        endTime: "23:59",
        durationMinutes: 60,
        priceTotalCents: 4800,
        referenceCapacity: 4,
        priority: 10,
        tags: [],
      },
    });
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.tariffRule.deleteMany({ where: { courtId } });
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
    const bookingsRepo = new BookingsRepository(prisma);
    const legacy = new FakeLegacyProvider();
    const bookingsService = new BookingsService(
      bookingsRepo,
      new CourtsRepository(prisma),
      new PricingService(new PricingRepository(prisma)),
      legacy,
      config,
      buildTestAccessGrantService(prisma, config),
      buildTestNotificationService(prisma),
    );
    return new BookingsAdminService(
      bookingsRepo,
      legacy,
      config,
      buildTestAccessGrantService(prisma, config),
      buildTestNotificationService(prisma),
      new AuditLogService(new AuditLogRepository(prisma)),
      bookingsService,
      new IdentityRepository(prisma),
      new CourtsRepository(prisma),
    );
  }

  async function createPendingBooking(): Promise<Booking> {
    const start = new Date(Date.now() + 48 * 3600_000);
    return prisma.booking.create({
      data: {
        organizer: { connect: { id: organizerUserId } },
        court: { connect: { id: courtId } },
        startAt: start,
        endAt: new Date(start.getTime() + 3600_000),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "CHECKOUT_PENDING",
      },
    });
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

  it("lists Doinsport-only occupations within a date range for the planning grid (CDC §55 écran 3)", async () => {
    const legacyClient = await prisma.legacyClient.create({
      data: { externalId: `ext-legacy-${Date.now()}-${Math.random()}`, firstName: "Jean", lastName: "Legacy", lastSyncedAt: new Date() },
    });
    const legacyBooking = await prisma.legacyBooking.create({
      data: {
        externalId: `legacy-booking-${Date.now()}`,
        courtId,
        legacyClientId: legacyClient.externalId,
        startAt: new Date(Date.now() + 24 * 3600_000),
        endAt: new Date(Date.now() + 25 * 3600_000),
        canceled: false,
        lastSyncedAt: new Date(),
      },
    });
    const canceledBooking = await prisma.legacyBooking.create({
      data: {
        externalId: `legacy-booking-canceled-${Date.now()}`,
        courtId,
        startAt: new Date(Date.now() + 26 * 3600_000),
        endAt: new Date(Date.now() + 27 * 3600_000),
        canceled: true,
        lastSyncedAt: new Date(),
      },
    });
    const service = buildService();

    const results = await service.listLegacyForDashboard(new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 72 * 3600_000).toISOString());

    expect(results.some((r) => r.id === legacyBooking.id && r.clientName === "Jean Legacy")).toBe(true);
    expect(results.some((r) => r.id === canceledBooking.id)).toBe(false);
  });

  it("includes non-canceled participants (with their active bookings count) and the paid status on Doinsport occupations", async () => {
    const legacyBooking = await prisma.legacyBooking.create({
      data: {
        externalId: `legacy-booking-participants-${Date.now()}`,
        courtId,
        startAt: new Date(Date.now() + 24 * 3600_000),
        endAt: new Date(Date.now() + 25 * 3600_000),
        canceled: false,
        fullyPaid: false,
        comment: "Merci de préparer 4 raquettes",
        lastSyncedAt: new Date(),
      },
    });
    await prisma.legacyBookingParticipant.createMany({
      data: [
        { legacyBookingId: legacyBooking.id, firstName: "Alain", lastName: "Monfort", canceled: false, activeBookingsCount: 101 },
        { legacyBookingId: legacyBooking.id, firstName: "Alain", lastName: "Samray", canceled: false, activeBookingsCount: 80 },
        { legacyBookingId: legacyBooking.id, firstName: "Retrait", lastName: "Annulé", canceled: true, activeBookingsCount: 5 },
      ],
    });
    const service = buildService();

    const results = await service.listLegacyForDashboard(new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 72 * 3600_000).toISOString());
    const found = results.find((r) => r.id === legacyBooking.id);

    expect(found?.fullyPaid).toBe(false);
    expect(found?.comment).toBe("Merci de préparer 4 raquettes");
    expect(found?.participants).toEqual(
      expect.arrayContaining([
        { firstName: "Alain", lastName: "Monfort", activeBookingsCount: 101 },
        { firstName: "Alain", lastName: "Samray", activeBookingsCount: 80 },
      ]),
    );
    expect(found?.participants.some((p) => p.lastName === "Annulé")).toBe(false);
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

  it("gets a booking by id with the organizer's identity attached, regardless of who's asking (CDC §55 écran 4)", async () => {
    const booking = await createConfirmedBooking();
    const service = buildService();

    const result = await service.getById(booking.id);
    expect(result.id).toBe(booking.id);
    expect(result.organizer).toMatchObject({ id: organizerUserId, firstName: "O", lastName: "R" });
  });

  it("rejects getById for an unknown booking", async () => {
    const service = buildService();
    await expect(service.getById("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ httpStatus: 404 });
  });

  it("creates a booking on behalf of an existing customer, source ADMIN, audited (CDC §55 écran 5)", async () => {
    const service = buildService();
    const startAt = new Date(Date.now() + 48 * 3600_000).toISOString();

    const booking = await service.adminCreate(
      { organizerUserId, courtId, startAt, durationMinutes: 60 },
      actorUserId,
    );

    expect(booking.organizerUserId).toBe(organizerUserId);
    expect(booking.source).toBe("ADMIN");
    expect(booking.status).toBe("CHECKOUT_PENDING");

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "Booking", targetId: booking.id });
    expect(entries.some((e) => e.action === "BOOKING_ADMIN_CREATED")).toBe(true);
  });

  it("rejects creating a booking for an unknown customer", async () => {
    const service = buildService();
    const startAt = new Date(Date.now() + 48 * 3600_000).toISOString();
    await expect(
      service.adminCreate(
        { organizerUserId: "00000000-0000-0000-0000-000000000000", courtId, startAt, durationMinutes: 60 },
        actorUserId,
      ),
    ).rejects.toMatchObject({ httpStatus: 404 });
  });

  it("adds a participant to a pending booking on behalf of the organizer, without requiring the actor to be the organizer, and audits it (CDC §55 écran 5)", async () => {
    const booking = await createPendingBooking();
    const service = buildService();

    const participant = await service.adminAddParticipant(booking.id, actorUserId, { displayName: "Ami du client" });
    expect(participant.displayName).toBe("Ami du client");
    expect(participant.status).toBe("INVITED");

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "Booking", targetId: booking.id });
    expect(entries.some((e) => e.action === "BOOKING_ADMIN_PARTICIPANT_ADDED")).toBe(true);
  });

  it("rejects adding a participant once the court capacity would be exceeded", async () => {
    // Capacité 4 : l'organisateur occupe une place, donc 3 participants
    // supplémentaires au maximum avant que le terrain soit complet.
    const booking = await createPendingBooking();
    const service = buildService();
    await service.adminAddParticipant(booking.id, actorUserId, { displayName: "Joueur 1" });
    await service.adminAddParticipant(booking.id, actorUserId, { displayName: "Joueur 2" });
    await service.adminAddParticipant(booking.id, actorUserId, { displayName: "Joueur 3" });

    await expect(service.adminAddParticipant(booking.id, actorUserId, { displayName: "Joueur 4" })).rejects.toMatchObject({ httpStatus: 422 });
  });

  it("rejects adding a participant once the booking is confirmed", async () => {
    const booking = await createConfirmedBooking();
    const service = buildService();
    await expect(service.adminAddParticipant(booking.id, actorUserId, { displayName: "Trop tard" })).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("removes a participant from a pending booking, auditing it", async () => {
    const booking = await createPendingBooking();
    const service = buildService();
    const participant = await service.adminAddParticipant(booking.id, actorUserId, { displayName: "À retirer" });

    await service.adminRemoveParticipant(booking.id, actorUserId, participant.id);

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "Booking", targetId: booking.id });
    expect(entries.some((e) => e.action === "BOOKING_ADMIN_PARTICIPANT_REMOVED")).toBe(true);
  });

  it("rejects removing an unknown participant", async () => {
    const booking = await createPendingBooking();
    const service = buildService();
    await expect(
      service.adminRemoveParticipant(booking.id, actorUserId, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ httpStatus: 404 });
  });
});
