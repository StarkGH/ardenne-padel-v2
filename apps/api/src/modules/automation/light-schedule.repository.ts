import type { PrismaClient } from "@prisma/client";

/**
 * Source des créneaux occupés pour le calcul de l'éclairage (dossier
 * technique §42). Les deux tables sont interrogées — `Booking` (V2 natif ou
 * synchronisé Dual Run, `legacySyncStatus`) et `LegacyBooking` (occupations
 * Doinsport pas encore matérialisées côté V2, CDC §55 écran 3, même lacune
 * déjà connue et traitée pour le planning admin) — car une lumière doit
 * s'allumer pour toute réservation réelle du terrain, quelle que soit son
 * origine. Un doublon entre les deux sources (réservation déjà synchronisée)
 * ne pose aucun problème : la fusion d'intervalles absorbe les chevauchements.
 */
export class LightScheduleRepository {
  constructor(private readonly db: PrismaClient) {}

  async findOccupiedWindowsForCourt(courtId: string, from: Date, to: Date): Promise<Array<{ start: Date; end: Date }>> {
    const [bookings, legacyBookings] = await Promise.all([
      this.db.booking.findMany({
        where: { courtId, status: { in: ["CONFIRMED", "COMPLETED"] }, startAt: { lt: to }, endAt: { gt: from } },
        select: { startAt: true, endAt: true },
      }),
      this.db.legacyBooking.findMany({
        where: { courtId, canceled: false, startAt: { lt: to }, endAt: { gt: from } },
        select: { startAt: true, endAt: true },
      }),
    ]);

    return [...bookings, ...legacyBookings].map((b) => ({ start: b.startAt, end: b.endAt }));
  }
}
