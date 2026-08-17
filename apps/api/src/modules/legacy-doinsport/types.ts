/**
 * Interface stable CDC §12.1. Le reste de l'application ne doit jamais
 * connaître les endpoints HTTP Doinsport, IRI API Platform ou structures
 * `hydra:member` — tout est traduit ici.
 */

export interface LegacyAuth {
  token: string;
  userClubId: string;
}

export interface LegacyClientDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  gsm: string;
}

export interface LegacyBookingSummaryDto {
  id: string;
  startAt: string;
  endAt: string;
  canceled: boolean;
}

export interface LegacyBookingDto {
  id: string;
  startAt: string;
  endAt: string;
  canceled: boolean;
  comment: string | null;
  playgroundIds: string[];
  accessCodes: Array<{ playgroundName?: string; code?: string; accessCodeEnabledBefore?: string }>;
  /**
   * `legacy_clients.externalId` du participant `bookingOwner: true` (import
   * historique, ADR-0031) — distinct de `participants[].user`, qui référence
   * le membre du staff ayant créé la réservation, pas le client. `null` si
   * la réservation n'a aucun participant marqué `bookingOwner` (rare, ex.
   * créneau bloqué par le club sans client).
   */
  bookingOwnerClientId: string | null;
  raw: unknown;
}

export interface LegacyCourtDto {
  id: string;
  name: string;
}

export interface DateRange {
  fromISO: string;
  toISO: string;
}

export interface LegacyPriceInput {
  /** Terrain **local** (courts.id) — l'adapter résout lui-même le playground/activity Legacy correspondants (CDC §2.5). */
  courtId: string;
  startAt: string;
  durationSeconds: number;
}

export interface LegacyPriceReference {
  timetableBlockPriceId: string;
  activityId: string;
  pricePerParticipant: number | null;
  currency: "EUR";
}

export interface LegacyCreateBooking {
  startAt: string;
  endAt: string;
  /** Terrain **local** (courts.id) — voir LegacyPriceInput. */
  courtId: string;
  timetableBlockPriceId?: string;
  /** `legacy_clients.externalId` du participant `bookingOwner`. */
  legacyClientId: string;
  /** Marqueur de corrélation `APV2:<booking_uuid>` — voir CDC §16.1. */
  correlationMarker: string;
  paymentMethod?: "on_the_spot";
}

export interface LegacyCancelOptions {
  withRefund: boolean;
}

export interface LegacyBookingProvider {
  authenticateClub(): Promise<LegacyAuth>;
  listClients(): Promise<LegacyClientDto[]>;
  listBookings(range: DateRange): Promise<LegacyBookingSummaryDto[]>;
  getBooking(id: string): Promise<LegacyBookingDto>;
  listCourts(): Promise<LegacyCourtDto[]>;
  resolveLegacyPrice(input: LegacyPriceInput): Promise<LegacyPriceReference>;
  createBooking(input: LegacyCreateBooking): Promise<LegacyBookingDto>;
  cancelBooking(id: string, options: LegacyCancelOptions): Promise<LegacyBookingDto>;
}
