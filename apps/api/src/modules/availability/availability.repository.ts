import type { CourtType, PrismaClient } from "@prisma/client";

const ACTIVE_BOOKING_STATUSES = [
  "DRAFT",
  "CHECKOUT_PENDING",
  "LEGACY_HOLD_PENDING",
  "PAYMENT_PENDING",
  "CONFIRMED",
] as const;

export class AvailabilityRepository {
  constructor(private readonly db: PrismaClient) {}

  findOpeningRules(courtId: string, dayOfWeek: number, atDate: Date) {
    return this.db.openingRule.findMany({
      where: {
        active: true,
        dayOfWeek,
        OR: [{ courtId }, { courtId: null }],
        validFrom: { lte: atDate },
        AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: atDate } }] }],
      },
    });
  }

  findDurationRules(courtId: string, courtType: CourtType, atDate: Date) {
    return this.db.durationRule.findMany({
      where: {
        active: true,
        validFrom: { lte: atDate },
        AND: [
          { OR: [{ validUntil: null }, { validUntil: { gte: atDate } }] },
          { OR: [{ courtId }, { courtId: null, courtType }, { courtId: null, courtType: null }] },
        ],
      },
    });
  }

  findClosures(courtId: string, rangeStart: Date, rangeEnd: Date) {
    return this.db.courtClosure.findMany({
      where: {
        courtId,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
    });
  }

  /**
   * Occupations issues des réservations déjà connues de V2, fusionnées avec
   * les réservations Doinsport importées localement (`LegacyBooking`, Lot
   * 11, ADR-0033) — CDC §10.3 : *"les réservations Doinsport sont
   * intégrées comme occupations externes"*, non branché avant ce lot.
   * L'affichage de disponibilité reste par nature indicatif : l'arbitre
   * final anti-collision est le POST Doinsport au moment de la confirmation,
   * pas ce calcul — `LegacyBooking` n'est peuplé qu'au rythme du dernier
   * import manuel (pas encore de scheduler), jamais garanti à jour à la
   * seconde près.
   */
  async findOccupyingBookings(courtId: string, rangeStart: Date, rangeEnd: Date) {
    const [v2Bookings, legacyBookings] = await Promise.all([
      this.db.booking.findMany({
        where: {
          courtId,
          status: { in: [...ACTIVE_BOOKING_STATUSES] },
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        select: { startAt: true, endAt: true },
      }),
      this.db.legacyBooking.findMany({
        where: {
          courtId,
          canceled: false,
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        select: { startAt: true, endAt: true },
      }),
    ]);
    return [...v2Bookings, ...legacyBookings];
  }
}
