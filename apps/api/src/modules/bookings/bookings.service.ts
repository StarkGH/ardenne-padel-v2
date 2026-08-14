import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import type { Court } from "@prisma/client";
import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import type { CourtsRepository } from "../courts/courts.repository.js";
import type { PricingService } from "../pricing/pricing.service.js";
import type { LegacyBookingProvider } from "../legacy-doinsport/types.js";
import type { BookingsRepository } from "./bookings.repository.js";
import type { PaymentGateway } from "./mock-payment-gateway.js";
import { assertTransition } from "./booking-state-machine.js";

export interface CreateBookingInput {
  organizerUserId: string;
  courtId: string;
  /** Instant UTC de début (ISO 8601). */
  startAt: string;
  durationMinutes: number;
  source?: "WEB" | "PWA" | "ADMIN";
}

/**
 * Orchestration de création de réservation (CDC §18, §27). Le Lot 3 couvre
 * le chemin `DRAFT -> CHECKOUT_PENDING -> (Legacy) -> PAYMENT_PENDING ->
 * CONFIRMED` avec un paiement **simulé** (voir `mock-payment-gateway.ts`) —
 * le vrai paiement Stripe arrive au Lot 4 sans changer cette orchestration
 * dans ses grandes lignes (CDC §27.3 pour le cas wallet, à brancher plus tard).
 */
export class BookingsService {
  constructor(
    private readonly repo: BookingsRepository,
    private readonly courtsRepo: CourtsRepository,
    private readonly pricing: PricingService,
    private readonly legacyProvider: LegacyBookingProvider,
    private readonly paymentGateway: PaymentGateway,
    private readonly config: AppConfig,
  ) {}

  async createBooking(input: CreateBookingInput) {
    const court = await this.requireCourt(input.courtId);
    const startAt = DateTime.fromISO(input.startAt, { setZone: true }).toUTC();
    if (!startAt.isValid) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Date de début invalide.", 422);
    }
    const endAt = startAt.plus({ minutes: input.durationMinutes });

    const quote = await this.pricing.quote(court, startAt.toISO()!, input.durationMinutes);

    let booking = await this.repo.create({
      id: randomUUID(),
      organizer: { connect: { id: input.organizerUserId } },
      court: { connect: { id: court.id } },
      startAt: startAt.toJSDate(),
      endAt: endAt.toJSDate(),
      durationMinutes: input.durationMinutes,
      status: "DRAFT",
      paymentMode: "FULL", // CDC §21.4 : FULL est le mode par défaut. SPLIT arrive au Lot 6.
      bookingBasePriceCents: quote.priceTotalCents,
      priceTotalCents: quote.priceTotalCents,
      currency: quote.currency,
      source: input.source ?? "WEB",
      tariffRuleId: quote.ruleId,
      cancellationDeadline: startAt.minus({ hours: 24 }).toJSDate(), // valeur Lot 3 provisoire, configurable au Lot 9
    });

    assertTransition(booking.status, "CHECKOUT_PENDING");
    booking = await this.repo.updateStatus(booking.id, "CHECKOUT_PENDING");

    if (this.config.LEGACY_WRITE_ENABLED) {
      const correlationMarker = `APV2:${booking.id}`;
      await this.repo.createLegacyMapping(booking.id, correlationMarker);

      try {
        await this.createInLegacy(booking.id, input.organizerUserId, court, startAt, endAt, input.durationMinutes, quote.priceTotalCents, correlationMarker);
      } catch (err) {
        if (err instanceof AppError && err.code === "BOOKING_SLOT_UNAVAILABLE") {
          await this.repo.updateStatus(booking.id, "FAILED");
          await this.repo.updateLegacyMapping(booking.id, { syncStatus: "FAILED", lastError: err.message });
          throw err;
        }
        // Toute autre erreur Legacy : ne jamais confirmer sans garantie (CDC §48.1).
        await this.repo.updateStatus(booking.id, "MANUAL_REVIEW");
        await this.repo.updateLegacyMapping(booking.id, {
          syncStatus: "CONFIRMATION_UNKNOWN",
          lastError: err instanceof Error ? err.message : String(err),
        });
        logger.error({ event: "LegacyBookingCreationFailed", bookingId: booking.id, err }, "création Legacy en échec, MANUAL_REVIEW");
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "La réservation n'a pas pu être confirmée pour le moment.", 502);
      }
    } else {
      // `LEGACY_WRITE_ENABLED=false` : aucune ligne de mapping créée, donc
      // `booking.legacyBookingMapping` reste `null` (relation optionnelle) —
      // pas besoin d'un statut "NOT_REQUIRED" dédié pour le représenter.
      logger.warn(
        { event: "LegacyWriteSkipped", bookingId: booking.id },
        "LEGACY_WRITE_ENABLED=false : réservation créée côté V2 uniquement (dev/test)",
      );
    }

    booking = await this.repo.updateStatus(booking.id, "PAYMENT_PENDING");

    // CDC §91 Lot 3 : paiement simulé (Lot 4 branchera Stripe ici sans changer
    // le reste de l'orchestration).
    const payment = await this.paymentGateway.captureFullPayment({ bookingId: booking.id, amountCents: quote.priceTotalCents });
    if (!payment.succeeded) {
      booking = await this.repo.updateStatus(booking.id, "FAILED");
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le paiement n'a pas pu être validé. La réservation n'est pas confirmée.", 402);
    }

    booking = await this.repo.updateStatus(booking.id, "CONFIRMED", {
      paymentStatus: "PAID",
      confirmedAt: new Date(),
    });

    logger.info({ event: "BookingConfirmed", bookingId: booking.id }, "réservation confirmée");
    return booking;
  }

  private async createInLegacy(
    bookingId: string,
    organizerUserId: string,
    court: Court,
    startAt: DateTime,
    endAt: DateTime,
    durationMinutes: number,
    v2PriceTotalCents: number,
    correlationMarker: string,
  ): Promise<void> {
    const legacyClient = await this.repo.findLegacyClientLinkedToUser(organizerUserId);
    if (!legacyClient) {
      // Pas de lien Shadow Client -> pas d'hypothèse silencieuse (CDC §111) :
      // MANUAL_REVIEW plutôt qu'une création Legacy avec un client inventé.
      throw new Error(`Organisateur ${organizerUserId} non lié à un client Legacy (migration CDC §7.3 non complétée)`);
    }

    const legacyPrice = await this.legacyProvider.resolveLegacyPrice({
      courtId: court.id,
      startAt: startAt.toISO()!,
      durationSeconds: durationMinutes * 60,
    });

    const diff = Math.abs((legacyPrice.pricePerParticipant ?? 0) * court.capacity - v2PriceTotalCents);
    if (diff > this.config.LEGACY_PRICE_MISMATCH_TOLERANCE_CENTS) {
      logger.warn(
        { event: "PriceMismatch", bookingId, v2PriceTotalCents, legacyPriceTotalEstimate: (legacyPrice.pricePerParticipant ?? 0) * court.capacity, diffCents: diff },
        "écart de prix V2/Legacy au-delà de la tolérance configurée (CDC §11.3)",
      );
    }

    const legacyBooking = await this.legacyProvider.createBooking({
      startAt: startAt.toISO()!,
      endAt: endAt.toISO()!,
      courtId: court.id,
      timetableBlockPriceId: legacyPrice.timetableBlockPriceId,
      legacyClientId: legacyClient.externalId,
      correlationMarker,
    });

    await this.repo.updateLegacyMapping(bookingId, {
      legacyBookingId: legacyBooking.id,
      syncStatus: "CONFIRMED",
      lastSyncAt: new Date(),
    });
  }

  /** CDC §29.2 — annulation client dans le délai autorisé. */
  async cancelBooking(id: string, requestedByUserId: string) {
    const booking = await this.repo.findById(id);
    if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);
    if (booking.organizerUserId !== requestedByUserId) {
      throw new AppError(ErrorCodes.FORBIDDEN, "Seul l'organisateur peut annuler cette réservation.", 403);
    }
    if (booking.status !== "CONFIRMED") {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Cette réservation ne peut pas être annulée dans son état actuel.", 409);
    }
    if (booking.cancellationDeadline && new Date() > booking.cancellationDeadline) {
      throw new AppError(
        "CANCELLATION_DEADLINE_PASSED",
        "Cette réservation ne peut plus être annulée en ligne. Contactez le club si nécessaire.",
        409,
      );
    }

    assertTransition(booking.status, "CANCEL_PENDING");
    await this.repo.updateStatus(booking.id, "CANCEL_PENDING");

    if (booking.legacyBookingMapping?.legacyBookingId && this.config.LEGACY_WRITE_ENABLED) {
      try {
        await this.legacyProvider.cancelBooking(booking.legacyBookingMapping.legacyBookingId, { withRefund: false });
        await this.repo.updateLegacyMapping(booking.id, { syncStatus: "CANCELED" });
      } catch (err) {
        // CDC §29.5 : si l'annulation Legacy échoue, ne pas bloquer indéfiniment
        // côté V2 — CANCEL_PENDING + alerte, à reprendre par un job de retry (Lot 8).
        logger.error({ event: "LegacyCancelFailed", bookingId: booking.id, err }, "annulation Legacy en échec");
        await this.repo.updateLegacyMapping(booking.id, {
          syncStatus: "CANCEL_PENDING",
          lastError: err instanceof Error ? err.message : String(err),
        });
        return this.repo.findById(booking.id);
      }
    }

    const canceled = await this.repo.updateStatus(booking.id, "CANCELED", { canceledAt: new Date() });
    logger.info({ event: "BookingCanceled", bookingId: booking.id }, "réservation annulée");
    return canceled;
  }

  async getById(id: string) {
    const booking = await this.repo.findById(id);
    if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);
    return booking;
  }

  async listForOrganizer(organizerUserId: string) {
    return this.repo.findByOrganizer(organizerUserId);
  }

  private async requireCourt(courtId: string): Promise<Court> {
    const court = await this.courtsRepo.findById(courtId);
    if (!court || !court.active) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Terrain introuvable.", 404);
    }
    return court;
  }
}
