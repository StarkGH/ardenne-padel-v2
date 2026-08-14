import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests, type AppConfig } from "@ardenne/config";
import { AppError } from "@ardenne/shared";
import type {
  DateRange,
  LegacyAuth,
  LegacyBookingDto,
  LegacyBookingProvider,
  LegacyBookingSummaryDto,
  LegacyCancelOptions,
  LegacyClientDto,
  LegacyCourtDto,
  LegacyCreateBooking,
  LegacyPriceInput,
  LegacyPriceReference,
} from "../legacy-doinsport/types.js";
import { BookingsRepository } from "./bookings.repository.js";
import { CourtsRepository } from "../courts/courts.repository.js";
import { PricingRepository } from "../pricing/pricing.repository.js";
import { PricingService } from "../pricing/pricing.service.js";
import { BookingsService } from "./bookings.service.js";
import { MockAlwaysSucceedsPaymentGateway } from "./mock-payment-gateway.js";

/**
 * Orchestration Dual Run (CDC §27) testée avec un faux `LegacyBookingProvider`
 * — aucun appel réseau vers Doinsport, mais le contrat de l'interface est
 * bien celui utilisé en production (mêmes types que `LegacyDoinsportAdapter`).
 */
class FakeLegacyProvider implements LegacyBookingProvider {
  createBookingResult: LegacyBookingDto | "COLLISION" | "ERROR" = {
    id: "legacy-booking-1",
    startAt: "",
    endAt: "",
    canceled: false,
    comment: null,
    playgroundIds: [],
    accessCodes: [],
    raw: null,
  };
  lastCreateBookingInput: LegacyCreateBooking | null = null;
  resolvedPricePerParticipant = 1200; // -> total estimé 4 participants = 4800

  async authenticateClub(): Promise<LegacyAuth> {
    return { token: "fake-token", userClubId: "fake-userclub" };
  }
  async listClients(): Promise<LegacyClientDto[]> {
    return [];
  }
  async listBookings(_range: DateRange): Promise<LegacyBookingSummaryDto[]> {
    return [];
  }
  async getBooking(id: string): Promise<LegacyBookingDto> {
    return { id, startAt: "", endAt: "", canceled: false, comment: null, playgroundIds: [], accessCodes: [], raw: null };
  }
  async listCourts(): Promise<LegacyCourtDto[]> {
    return [];
  }
  async resolveLegacyPrice(_input: LegacyPriceInput): Promise<LegacyPriceReference> {
    return {
      timetableBlockPriceId: "fake-price-id",
      activityId: "fake-activity-id",
      pricePerParticipant: this.resolvedPricePerParticipant,
      currency: "EUR",
    };
  }
  async createBooking(input: LegacyCreateBooking): Promise<LegacyBookingDto> {
    this.lastCreateBookingInput = input;
    if (this.createBookingResult === "COLLISION") {
      throw new AppError("BOOKING_SLOT_UNAVAILABLE", "Ce créneau vient d'être réservé.", 409);
    }
    if (this.createBookingResult === "ERROR") {
      throw new Error("Doinsport indisponible (simulation de test)");
    }
    return { ...this.createBookingResult, startAt: input.startAt, endAt: input.endAt, comment: input.correlationMarker };
  }
  async cancelBooking(id: string, _options: LegacyCancelOptions): Promise<LegacyBookingDto> {
    return { id, startAt: "", endAt: "", canceled: true, comment: null, playgroundIds: [], accessCodes: [], raw: null };
  }
}

describe("BookingsService — orchestration Dual Run avec LEGACY_WRITE_ENABLED=true", () => {
  let prisma: PrismaClient;
  let config: AppConfig;
  let courtId: string;
  let organizerUserId: string;

  beforeAll(async () => {
    resetConfigCacheForTests();
    prisma = new PrismaClient();
    config = { ...loadConfig(), LEGACY_WRITE_ENABLED: true, LEGACY_PRICE_MISMATCH_TOLERANCE_CENTS: 50 };

    const court = await prisma.court.upsert({
      where: { slug: "test-padel-legacy" },
      update: {},
      create: { slug: "test-padel-legacy", name: "Test Padel Legacy", courtType: "DOUBLE", capacity: 4, displayOrder: 98 },
    });
    courtId = court.id;

    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.tariffRule.create({
      data: {
        name: "Tarif test legacy",
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

  let organizerCounter = 0;
  beforeEach(async () => {
    organizerCounter += 1;
    const user = await prisma.user.create({
      data: {
        email: `legacy-orchestration-${organizerCounter}@example.com`,
        passwordHash: "irrelevant-not-used-in-this-test",
        firstName: "Test",
        lastName: "Organizer",
        status: "ACTIVE",
      },
    });
    organizerUserId = user.id;
    await prisma.booking.deleteMany({ where: { courtId } });
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { courtId } });
    await prisma.legacyClient.deleteMany({ where: { linkedUserId: { not: null } } });
    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.court.delete({ where: { id: courtId } });
    await prisma.$disconnect();
  });

  function buildService(legacy: FakeLegacyProvider) {
    return new BookingsService(
      new BookingsRepository(prisma),
      new CourtsRepository(prisma),
      new PricingService(new PricingRepository(prisma)),
      legacy,
      new MockAlwaysSucceedsPaymentGateway(),
      config,
    );
  }

  async function linkLegacyClient(userId: string, externalId: string) {
    await prisma.legacyClient.create({
      data: { externalId, firstName: "Legacy", lastName: "Client", lastSyncedAt: new Date(), linkedUserId: userId },
    });
  }

  it("goes to MANUAL_REVIEW when the organizer has no linked Legacy client (no silent assumption, CDC §111)", async () => {
    const legacy = new FakeLegacyProvider();
    const service = buildService(legacy);

    await expect(
      service.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(10), durationMinutes: 60 }),
    ).rejects.toThrow();

    const bookings = await prisma.booking.findMany({ where: { organizerUserId }, include: { legacyBookingMapping: true } });
    expect(bookings).toHaveLength(1);
    expect(bookings[0]!.status).toBe("MANUAL_REVIEW");
    expect(bookings[0]!.legacyBookingMapping?.syncStatus).toBe("CONFIRMATION_UNKNOWN");
    expect(legacy.lastCreateBookingInput).toBeNull(); // jamais appelé avec un client inventé
  });

  it("confirms the booking and records the Legacy booking id when creation succeeds", async () => {
    await linkLegacyClient(organizerUserId, "legacy-client-ok");
    const legacy = new FakeLegacyProvider();
    const service = buildService(legacy);

    const booking = await service.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(11), durationMinutes: 60 });

    expect(booking.status).toBe("CONFIRMED");
    expect(legacy.lastCreateBookingInput?.legacyClientId).toBe("legacy-client-ok");
    expect(legacy.lastCreateBookingInput?.correlationMarker).toBe(`APV2:${booking.id}`);

    const mapping = await prisma.legacyBookingMapping.findUnique({ where: { bookingId: booking.id } });
    expect(mapping?.syncStatus).toBe("CONFIRMED");
    expect(mapping?.legacyBookingId).toBe("legacy-booking-1");
  });

  it("fails the booking (not confirmed) on a Legacy 422 collision", async () => {
    await linkLegacyClient(organizerUserId, "legacy-client-collision");
    const legacy = new FakeLegacyProvider();
    legacy.createBookingResult = "COLLISION";
    const service = buildService(legacy);

    await expect(
      service.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(12), durationMinutes: 60 }),
    ).rejects.toThrow(/vient d'être réservé|BOOKING_SLOT_UNAVAILABLE/);

    const bookings = await prisma.booking.findMany({ where: { organizerUserId } });
    expect(bookings[0]!.status).toBe("FAILED");
  });

  it("never confirms a booking when the Legacy creation fails for an unexpected reason (CDC §48.1)", async () => {
    await linkLegacyClient(organizerUserId, "legacy-client-error");
    const legacy = new FakeLegacyProvider();
    legacy.createBookingResult = "ERROR";
    const service = buildService(legacy);

    await expect(
      service.createBooking({ organizerUserId, courtId, startAt: futureMondayIso(13), durationMinutes: 60 }),
    ).rejects.toThrow();

    const bookings = await prisma.booking.findMany({ where: { organizerUserId } });
    expect(bookings[0]!.status).toBe("MANUAL_REVIEW");
  });
});

function futureMondayIso(hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
