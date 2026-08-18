import type { Prisma, PrismaClient } from "@prisma/client";
import type { BookingStatus } from "./booking-state-machine.js";

export class BookingsRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.BookingCreateInput) {
    return this.db.booking.create({ data });
  }

  findById(id: string) {
    return this.db.booking.findUnique({
      where: { id },
      include: { participants: true, legacyBookingMapping: true, court: true },
    });
  }

  findByOrganizer(organizerUserId: string) {
    return this.db.booking.findMany({
      where: { organizerUserId },
      orderBy: { startAt: "desc" },
      include: { participants: true },
    });
  }

  /** CDC §39.1 — données du dashboard planning multi-terrains (timeline commune). */
  listInRange(fromDate: Date, toDate: Date) {
    return this.db.booking.findMany({
      where: { startAt: { gte: fromDate, lt: toDate } },
      orderBy: { startAt: "asc" },
      include: {
        participants: true,
        legacyBookingMapping: true,
        court: true,
        organizer: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  /**
   * CDC §55 écran 3 — occupations Doinsport-only à afficher sur le planning
   * admin (ADR-0033 les couvre déjà côté anti-collision/disponibilité, mais
   * la grille visuelle ne les affichait jamais — gap trouvé en vérifiant le
   * planning en direct). Jamais fusionné dans `listInRange` : ce sont deux
   * tables distinctes (`Booking` V2 vs `LegacyBooking` importé), pas le même
   * objet métier.
   */
  listLegacyOccupationsInRange(fromDate: Date, toDate: Date) {
    return this.db.legacyBooking.findMany({
      where: { canceled: false, startAt: { lt: toDate }, endAt: { gt: fromDate } },
      orderBy: { startAt: "asc" },
      include: {
        legacyClient: { select: { firstName: true, lastName: true } },
        participants: { where: { canceled: false }, orderBy: { activeBookingsCount: "desc" } },
      },
    });
  }

  /**
   * CDC §55 écran 3 — CA planning ventilé par canal de paiement V2 (Stripe
   * vs wallet). Réservations `CONFIRMED`/`COMPLETED` uniquement, comme le
   * reste du CA planning (voir ADR-0030 addendum "CA planning étendu").
   * `WalletTransaction` n'a pas de relation Prisma vers `Booking` (simple
   * `bookingId`, voir schema.prisma) — étape en deux temps plutôt qu'un
   * filtre imbriqué : les ids de réservations de la période d'abord, puis
   * une agrégation par table sur ces ids. `Payment` compte les paiements
   * carte réussis (`purpose` réservation, pas achat de pack crédits) ;
   * `WalletTransaction` compte les débits wallet liés à une réservation
   * (`amountCents` signé négatif en base, valeur absolue ici).
   */
  async sumRevenueByChannelInRange(fromDate: Date, toDate: Date): Promise<{ stripeCents: number; walletCents: number }> {
    const bookings = await this.db.booking.findMany({
      where: { status: { in: ["CONFIRMED", "COMPLETED"] }, startAt: { gte: fromDate, lt: toDate } },
      select: { id: true },
    });
    const bookingIds = bookings.map((b) => b.id);
    if (bookingIds.length === 0) return { stripeCents: 0, walletCents: 0 };

    const [stripeAgg, walletAgg] = await Promise.all([
      this.db.payment.aggregate({
        where: { bookingId: { in: bookingIds }, status: "SUCCEEDED", purpose: { in: ["BOOKING_FULL", "BOOKING_SHARE"] } },
        _sum: { amountCents: true },
      }),
      this.db.walletTransaction.aggregate({
        where: { bookingId: { in: bookingIds }, type: "DEBIT_BOOKING" },
        _sum: { amountCents: true },
      }),
    ]);

    return {
      stripeCents: stripeAgg._sum.amountCents ?? 0,
      walletCents: Math.abs(walletAgg._sum.amountCents ?? 0),
    };
  }

  /**
   * CDC §55 écran 22 — accès, admin uniquement. Jamais fusionné dans
   * `findById`/`listInRange` (utilisés aussi par les parcours client) :
   * `codeCiphertext`/`codeIv` ne doivent jamais transiter par une réponse
   * client, même chiffrés (CDC §57.1) — cette projection les exclut
   * explicitement plutôt que de compter sur l'appelant pour les filtrer.
   */
  listAccessGrantsInRange(fromDate: Date, toDate: Date) {
    return this.db.accessGrant.findMany({
      where: { booking: { startAt: { gte: fromDate, lt: toDate } } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        bookingId: true,
        origin: true,
        scope: true,
        status: true,
        validFrom: true,
        validUntil: true,
        provisionedAt: true,
        revokedAt: true,
        providerReference: true,
        createdAt: true,
        booking: { select: { startAt: true, court: { select: { name: true } }, organizer: { select: { firstName: true, lastName: true, email: true } } } },
      },
    });
  }

  updateStatus(id: string, status: BookingStatus, extra: Prisma.BookingUpdateInput = {}) {
    return this.db.booking.update({ where: { id }, data: { status, ...extra } });
  }

  /**
   * Transition atomique et conditionnelle — CDC §67 : deux tentatives de
   * paiement concurrentes sur la même réservation (double clic) ne doivent
   * produire qu'un seul effet. Contrairement à `updateStatus`, échoue
   * silencieusement (retourne `false`) plutôt que d'écraser un état déjà
   * modifié par une autre requête.
   */
  async transitionStatus(id: string, fromStatus: BookingStatus, toStatus: BookingStatus): Promise<boolean> {
    const result = await this.db.booking.updateMany({ where: { id, status: fromStatus }, data: { status: toStatus } });
    return result.count === 1;
  }

  createLegacyMapping(bookingId: string, correlationMarker: string) {
    return this.db.legacyBookingMapping.create({ data: { bookingId, correlationMarker } });
  }

  updateLegacyMapping(bookingId: string, data: Prisma.LegacyBookingMappingUpdateInput) {
    return this.db.legacyBookingMapping.update({ where: { bookingId }, data });
  }

  findLegacyClientLinkedToUser(userId: string) {
    return this.db.legacyClient.findFirst({ where: { linkedUserId: userId } });
  }

  addParticipant(data: Prisma.BookingParticipantCreateInput) {
    return this.db.bookingParticipant.create({ data });
  }

  removeParticipant(id: string) {
    return this.db.bookingParticipant.update({ where: { id }, data: { status: "REMOVED" } });
  }
}
