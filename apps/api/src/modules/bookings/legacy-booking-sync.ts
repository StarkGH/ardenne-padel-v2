import type { DateTime } from "luxon";
import type { Court } from "@prisma/client";
import { logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import type { LegacyBookingProvider } from "../legacy-doinsport/types.js";
import type { BookingsRepository } from "./bookings.repository.js";

export interface CreateBookingInLegacyInput {
  bookingId: string;
  organizerUserId: string;
  court: Court;
  startAt: DateTime;
  endAt: DateTime;
  durationMinutes: number;
  v2PriceTotalCents: number;
  correlationMarker: string;
}

/**
 * Étape "créer en Legacy" de l'orchestration (CDC §27.1) — utilisée par le
 * checkout de paiement (Lot 4). Extrait de `BookingsService` pour être
 * réutilisable sans dupliquer la logique de comparaison de prix (§11.3) ni
 * le garde-fou "pas de client Legacy inventé" (§111).
 */
export async function createBookingInLegacy(
  repo: BookingsRepository,
  legacyProvider: LegacyBookingProvider,
  config: AppConfig,
  input: CreateBookingInLegacyInput,
): Promise<{ legacyBookingId: string }> {
  const legacyClient = await repo.findLegacyClientLinkedToUser(input.organizerUserId);
  if (!legacyClient) {
    throw new Error(`Organisateur ${input.organizerUserId} non lié à un client Legacy (migration CDC §7.3 non complétée)`);
  }

  const legacyPrice = await legacyProvider.resolveLegacyPrice({
    courtId: input.court.id,
    startAt: input.startAt.toISO()!,
    durationSeconds: input.durationMinutes * 60,
  });

  const diff = Math.abs((legacyPrice.pricePerParticipant ?? 0) * input.court.capacity - input.v2PriceTotalCents);
  if (diff > config.LEGACY_PRICE_MISMATCH_TOLERANCE_CENTS) {
    logger.warn(
      {
        event: "PriceMismatch",
        bookingId: input.bookingId,
        v2PriceTotalCents: input.v2PriceTotalCents,
        legacyPriceTotalEstimate: (legacyPrice.pricePerParticipant ?? 0) * input.court.capacity,
        diffCents: diff,
      },
      "écart de prix V2/Legacy au-delà de la tolérance configurée (CDC §11.3)",
    );
  }

  const legacyBooking = await legacyProvider.createBooking({
    startAt: input.startAt.toISO()!,
    endAt: input.endAt.toISO()!,
    courtId: input.court.id,
    timetableBlockPriceId: legacyPrice.timetableBlockPriceId,
    legacyClientId: legacyClient.externalId,
    correlationMarker: input.correlationMarker,
  });

  await repo.updateLegacyMapping(input.bookingId, {
    legacyBookingId: legacyBooking.id,
    syncStatus: "CONFIRMED",
    lastSyncAt: new Date(),
  });

  return { legacyBookingId: legacyBooking.id };
}
