import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, type Court } from "@prisma/client";
import { DateTime } from "luxon";
import { DISPLAY_TIMEZONE } from "@ardenne/shared";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { AvailabilityRepository } from "./availability.repository.js";
import { AvailabilityService } from "./availability.service.js";

/**
 * CDC §10.3 — "les réservations Doinsport sont intégrées comme occupations
 * externes" (Lot 11, ADR-0033) : un `LegacyBooking` importé doit bloquer un
 * créneau exactement comme un `Booking` V2, sans qu'aucune réservation V2
 * n'existe derrière.
 */
describe("AvailabilityService — anti-collision Dual Run (CDC §10.3)", () => {
  const prisma = new PrismaClient();
  let court: Court;

  function nextMonday(): DateTime {
    const today = DateTime.now().setZone(DISPLAY_TIMEZONE).startOf("day");
    const daysAhead = ((1 + 7 - today.weekday) % 7) || 7;
    return today.plus({ days: daysAhead });
  }

  beforeAll(async () => {
    court = await prisma.court.upsert({
      where: { slug: "test-padel-availability-legacy" },
      update: {},
      create: { slug: "test-padel-availability-legacy", name: "Test Padel Availability Legacy", courtType: "DOUBLE", capacity: 4, displayOrder: 87 },
    });

    await prisma.openingRule.deleteMany({ where: { courtId: court.id } });
    await prisma.durationRule.deleteMany({ where: { courtId: court.id } });
    for (let d = 0; d <= 6; d++) {
      await prisma.openingRule.create({
        data: { courtId: court.id, dayOfWeek: d, startTime: "08:00", endTime: "22:00", validFrom: new Date("2020-01-01") },
      });
    }
    await prisma.durationRule.create({
      data: { courtId: court.id, startTime: "00:00", endTime: "23:59", allowedDurationsMinutes: [60], validFrom: new Date("2020-01-01") },
    });
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.durationRule.deleteMany({ where: { courtId: court.id } });
    await prisma.openingRule.deleteMany({ where: { courtId: court.id } });
    await prisma.court.delete({ where: { id: court.id } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
  });

  function buildService() {
    return new AvailabilityService(new AvailabilityRepository(prisma));
  }

  it("hides a slot occupied by an imported Legacy booking, with no V2 Booking behind it", async () => {
    const monday = nextMonday();
    await prisma.legacyBooking.create({
      data: {
        externalId: "legacy-ext-1",
        courtId: court.id,
        startAt: monday.set({ hour: 10, minute: 0 }).toUTC().toJSDate(),
        endAt: monday.set({ hour: 11, minute: 0 }).toUTC().toJSDate(),
        lastSyncedAt: new Date(),
      },
    });

    const service = buildService();
    const slots = await service.getAvailability(court, monday.toISODate()!);

    expect(slots.some((s: { startMinute: number }) => s.startMinute === 10 * 60)).toBe(false);
  });

  it("does not hide a slot whose only Legacy booking is canceled", async () => {
    const monday = nextMonday();
    await prisma.legacyBooking.create({
      data: {
        externalId: "legacy-ext-canceled",
        courtId: court.id,
        startAt: monday.set({ hour: 11, minute: 0 }).toUTC().toJSDate(),
        endAt: monday.set({ hour: 12, minute: 0 }).toUTC().toJSDate(),
        canceled: true,
        lastSyncedAt: new Date(),
      },
    });

    const service = buildService();
    const slots = await service.getAvailability(court, monday.toISODate()!);

    expect(slots.some((s: { startMinute: number }) => s.startMinute === 11 * 60)).toBe(true);
  });

  it("still hides a slot occupied by a V2 booking, unaffected by the Legacy merge", async () => {
    const monday = nextMonday();
    const user = await prisma.user.create({
      data: { email: `avail-legacy-${Date.now()}@example.com`, passwordHash: "x", firstName: "A", lastName: "B", status: "ACTIVE" },
    });
    await prisma.booking.create({
      data: {
        organizer: { connect: { id: user.id } },
        court: { connect: { id: court.id } },
        startAt: monday.set({ hour: 14, minute: 0 }).toUTC().toJSDate(),
        endAt: monday.set({ hour: 15, minute: 0 }).toUTC().toJSDate(),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "CONFIRMED",
      },
    });

    const service = buildService();
    const slots = await service.getAvailability(court, monday.toISODate()!);

    expect(slots.some((s: { startMinute: number }) => s.startMinute === 14 * 60)).toBe(false);
  });

  it("blocks a slot covered by both a V2 booking and an imported Legacy booking without erroring (redundant overlap, ADR-0033)", async () => {
    const monday = nextMonday();
    const user = await prisma.user.create({
      data: { email: `avail-legacy-dup-${Date.now()}@example.com`, passwordHash: "x", firstName: "C", lastName: "D", status: "ACTIVE" },
    });
    await prisma.booking.create({
      data: {
        organizer: { connect: { id: user.id } },
        court: { connect: { id: court.id } },
        startAt: monday.set({ hour: 16, minute: 0 }).toUTC().toJSDate(),
        endAt: monday.set({ hour: 17, minute: 0 }).toUTC().toJSDate(),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "CONFIRMED",
      },
    });
    // Le même créneau, synchronisé depuis Doinsport (la réservation V2 a été
    // écrite là-bas pendant le Dual Run) — chevauchement attendu, pas un bug.
    await prisma.legacyBooking.create({
      data: {
        externalId: "legacy-ext-dup",
        courtId: court.id,
        startAt: monday.set({ hour: 16, minute: 0 }).toUTC().toJSDate(),
        endAt: monday.set({ hour: 17, minute: 0 }).toUTC().toJSDate(),
        lastSyncedAt: new Date(),
      },
    });

    const service = buildService();
    const slots = await service.getAvailability(court, monday.toISODate()!);

    expect(slots.some((s: { startMinute: number }) => s.startMinute === 16 * 60)).toBe(false);
  });

  it("does not leak a Legacy booking from a different court", async () => {
    const otherCourt = await prisma.court.upsert({
      where: { slug: "test-padel-availability-legacy-other" },
      update: {},
      create: { slug: "test-padel-availability-legacy-other", name: "Other", courtType: "DOUBLE", capacity: 4, displayOrder: 86 },
    });
    const monday = nextMonday();
    await prisma.legacyBooking.create({
      data: {
        externalId: "legacy-ext-other-court",
        courtId: otherCourt.id,
        startAt: monday.set({ hour: 12, minute: 0 }).toUTC().toJSDate(),
        endAt: monday.set({ hour: 13, minute: 0 }).toUTC().toJSDate(),
        lastSyncedAt: new Date(),
      },
    });

    const service = buildService();
    const slots = await service.getAvailability(court, monday.toISODate()!);

    expect(slots.some((s: { startMinute: number }) => s.startMinute === 12 * 60)).toBe(true);
    await prisma.legacyBooking.deleteMany({ where: { courtId: otherCourt.id } });
    await prisma.court.delete({ where: { id: otherCourt.id } });
  });
});
