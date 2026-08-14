import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { CourtsRepository } from "../courts/courts.repository.js";
import { PricingRepository } from "../pricing/pricing.repository.js";
import { PricingService } from "../pricing/pricing.service.js";
import { BookingsRepository } from "../bookings/bookings.repository.js";
import { BookingsService } from "../bookings/bookings.service.js";
import { LegacyDoinsportAdapter } from "../legacy-doinsport/legacy-doinsport.adapter.js";
import { LegacyDoinsportRepository } from "../legacy-doinsport/legacy-doinsport.repository.js";
import { KioskDeviceRepository } from "./kiosk-device.repository.js";
import { KioskDeviceService } from "./kiosk-device.service.js";
import { KioskCheckoutSessionRepository } from "./kiosk-checkout-session.repository.js";
import { KioskCheckoutSessionService } from "./kiosk-checkout-session.service.js";

/**
 * CDC §22.2 — QR handoff : création de session, consultation par token,
 * réclamation (création de la réservation), anti-réutilisation, expiration
 * et annulation. Contre une vraie base, `LEGACY_WRITE_ENABLED` à false.
 */
describe("KioskCheckoutSessionService", () => {
  const prisma = new PrismaClient();
  let courtId: string;
  let deviceService: KioskDeviceService;
  let sessionService: KioskCheckoutSessionService;
  let deviceId: string;
  let userId: string;

  function nextMondayAt(hour: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    d.setHours(hour, 0, 0, 0);
    return d;
  }

  beforeAll(async () => {
    resetConfigCacheForTests();
    const court = await prisma.court.upsert({
      where: { slug: "test-padel-kiosk" },
      update: {},
      create: { slug: "test-padel-kiosk", name: "Test Padel Kiosk", courtType: "DOUBLE", capacity: 4, displayOrder: 98 },
    });
    courtId = court.id;

    await prisma.openingRule.deleteMany({ where: { courtId } });
    await prisma.durationRule.deleteMany({ where: { courtId } });
    await prisma.tariffRule.deleteMany({ where: { courtId } });

    for (let d = 0; d <= 6; d++) {
      await prisma.openingRule.create({
        data: { courtId, dayOfWeek: d, startTime: "08:00", endTime: "22:00", validFrom: new Date("2020-01-01") },
      });
    }
    await prisma.durationRule.create({
      data: { courtId, startTime: "00:00", endTime: "23:59", allowedDurationsMinutes: [60], validFrom: new Date("2020-01-01") },
    });
    await prisma.tariffRule.create({
      data: {
        name: "Tarif kiosk",
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

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const config = loadConfig();

    const deviceRepo = new KioskDeviceRepository(prisma);
    deviceService = new KioskDeviceService(deviceRepo);
    const { deviceId: id } = await deviceService.register({ name: "Tablette test", capabilities: ["QR_HANDOFF"] });
    deviceId = id;

    const legacy = new LegacyDoinsportAdapter(config, new LegacyDoinsportRepository(prisma));
    const bookingsRepo = new BookingsRepository(prisma);
    const pricing = new PricingService(new PricingRepository(prisma));
    const bookingsService = new BookingsService(bookingsRepo, new CourtsRepository(prisma), pricing, legacy, config);
    const sessionRepo = new KioskCheckoutSessionRepository(prisma);
    sessionService = new KioskCheckoutSessionService(sessionRepo, bookingsService, bookingsRepo, config);

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `kiosk.${randomUUID()}@example.com`,
        passwordHash: "not-used",
        firstName: "Kiosk",
        lastName: "Client",
        status: "ACTIVE",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.durationRule.deleteMany({ where: { courtId } });
    await prisma.openingRule.deleteMany({ where: { courtId } });
    await prisma.court.delete({ where: { id: courtId } });
    await prisma.$disconnect();
  });

  it("creates a PENDING session bound to the kiosk device with a raw token and an expiry", async () => {
    const monday = nextMondayAt(9);
    const session = await sessionService.createSession({
      kioskDeviceId: deviceId,
      courtId,
      startAt: monday.toISOString(),
      durationMinutes: 60,
    });

    expect(session.id).toBeTruthy();
    expect(session.token).toBeTruthy();
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const preview = await sessionService.getByToken(session.token);
    expect(preview.status).toBe("PENDING");
    expect(preview.courtId).toBe(courtId);
  });

  it("claims a PENDING session for an authenticated user, creating a booking", async () => {
    const monday = nextMondayAt(10);
    const session = await sessionService.createSession({
      kioskDeviceId: deviceId,
      courtId,
      startAt: monday.toISOString(),
      durationMinutes: 60,
    });

    const booking = await sessionService.claim(session.token, userId);
    expect(booking.status).toBe("CHECKOUT_PENDING");
    expect(booking.organizerUserId).toBe(userId);

    const status = await sessionService.getStatusForKiosk(session.id, deviceId);
    expect(status.status).toBe("CLAIMED");
    expect(status.bookingId).toBe(booking.id);
    expect(status.bookingStatus).toBe("CHECKOUT_PENDING");
  });

  it("rejects a second claim attempt on an already-claimed session (anti-reuse, CDC §47.2.ter)", async () => {
    const monday = nextMondayAt(11);
    const session = await sessionService.createSession({
      kioskDeviceId: deviceId,
      courtId,
      startAt: monday.toISOString(),
      durationMinutes: 60,
    });

    await sessionService.claim(session.token, userId);
    await expect(sessionService.claim(session.token, userId)).rejects.toMatchObject({ code: "KIOSK_SESSION_ALREADY_CLAIMED" });
  });

  it("rejects lookup of an expired PENDING session", async () => {
    const monday = nextMondayAt(12);
    const session = await sessionService.createSession({
      kioskDeviceId: deviceId,
      courtId,
      startAt: monday.toISOString(),
      durationMinutes: 60,
    });

    await prisma.kioskCheckoutSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await expect(sessionService.getByToken(session.token)).rejects.toMatchObject({ code: "KIOSK_SESSION_EXPIRED" });
  });

  it("cancels a PENDING session and rejects a later claim attempt", async () => {
    const monday = nextMondayAt(13);
    const session = await sessionService.createSession({
      kioskDeviceId: deviceId,
      courtId,
      startAt: monday.toISOString(),
      durationMinutes: 60,
    });

    await sessionService.cancel(session.id, deviceId);

    const status = await sessionService.getStatusForKiosk(session.id, deviceId);
    expect(status.status).toBe("CANCELED");
    await expect(sessionService.claim(session.token, userId)).rejects.toMatchObject({ code: "KIOSK_SESSION_ALREADY_CLAIMED" });
  });

  it("rejects operating on a session owned by a different kiosk device", async () => {
    const monday = nextMondayAt(14);
    const session = await sessionService.createSession({
      kioskDeviceId: deviceId,
      courtId,
      startAt: monday.toISOString(),
      durationMinutes: 60,
    });

    const { deviceId: otherDeviceId } = await deviceService.register({ name: "Autre tablette", capabilities: ["QR_HANDOFF"] });
    await expect(sessionService.getStatusForKiosk(session.id, otherDeviceId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
