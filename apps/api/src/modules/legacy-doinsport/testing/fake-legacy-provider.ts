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
} from "../types.js";

/**
 * Double de test pour `LegacyBookingProvider` — aucun appel réseau vers
 * Doinsport, mais le même contrat d'interface que `LegacyDoinsportAdapter`
 * (utilisé en production). Partagé entre les tests `bookings` et `payments`.
 */
export class FakeLegacyProvider implements LegacyBookingProvider {
  createBookingResult: LegacyBookingDto | "COLLISION" | "ERROR" = {
    id: "legacy-booking-1",
    startAt: "",
    endAt: "",
    canceled: false,
    comment: null,
    playgroundIds: [],
    accessCodes: [],
    bookingOwnerClientId: null,
    raw: null,
  };
  lastCreateBookingInput: LegacyCreateBooking | null = null;
  resolvedPricePerParticipant = 1200;

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
    return { id, startAt: "", endAt: "", canceled: false, comment: null, playgroundIds: [], accessCodes: [], bookingOwnerClientId: null, raw: null };
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
    return { id, startAt: "", endAt: "", canceled: true, comment: null, playgroundIds: [], accessCodes: [], bookingOwnerClientId: null, raw: null };
  }
  activeBookingsCountByClient: Record<string, number> = {};
  async countActiveBookingsForClient(legacyClientId: string): Promise<number> {
    return this.activeBookingsCountByClient[legacyClientId] ?? 0;
  }
}
