import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import type { Court } from "@prisma/client";
import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import type { CourtsRepository } from "../courts/courts.repository.js";
import type { PricingService } from "../pricing/pricing.service.js";
import type { LegacyBookingProvider } from "../legacy-doinsport/types.js";
import type { BookingsRepository } from "./bookings.repository.js";
import { assertTransition } from "./booking-state-machine.js";

export interface CreateBookingInput {
  organizerUserId: string;
  courtId: string;
  /** Instant UTC de début (ISO 8601). */
  startAt: string;
  durationMinutes: number;
  source?: "WEB" | "PWA" | "ADMIN";
  paymentMode?: "FULL" | "SPLIT";
}

export interface AddParticipantInput {
  bookingId: string;
  requestedByUserId: string;
  displayName: string;
  userId?: string;
  legacyClientId?: string;
  invitedEmail?: string;
}

/**
 * Création de réservation (CDC §18) — s'arrête à `CHECKOUT_PENDING`. La
 * suite de l'orchestration (autorisation Stripe, création Legacy, capture —
 * CDC §27.1) est portée par `CheckoutService`/`SplitCheckoutService` (module
 * `payments`) : c'est eux qui reçoivent le moyen de paiement et font avancer
 * la réservation jusqu'à `CONFIRMED`. Cette séparation reflète les appels
 * API du CDC (§43 : `POST /bookings` puis `POST /payments/checkout`).
 */
export class BookingsService {
  constructor(
    private readonly repo: BookingsRepository,
    private readonly courtsRepo: CourtsRepository,
    private readonly pricing: PricingService,
    private readonly legacyProvider: LegacyBookingProvider,
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
    const paymentMode = input.paymentMode ?? "FULL";

    let booking = await this.repo.create({
      id: randomUUID(),
      organizer: { connect: { id: input.organizerUserId } },
      court: { connect: { id: court.id } },
      startAt: startAt.toJSDate(),
      endAt: endAt.toJSDate(),
      durationMinutes: input.durationMinutes,
      status: "DRAFT",
      paymentMode, // CDC §21.4 : FULL par défaut, SPLIT sur demande explicite.
      bookingBasePriceCents: quote.priceTotalCents,
      // CDC §24.3 : le frais de service est déterminé au choix du SPLIT et
      // snapshoté — un changement de config ultérieur n'affecte jamais une
      // réservation déjà créée.
      splitServiceFeeCents: paymentMode === "SPLIT" && this.config.SPLIT_SERVICE_FEE_ENABLED ? this.config.SPLIT_SERVICE_FEE_CENTS : null,
      splitServiceFeeAllocation: paymentMode === "SPLIT" && this.config.SPLIT_SERVICE_FEE_ENABLED ? this.config.SPLIT_SERVICE_FEE_ALLOCATION : null,
      priceTotalCents: quote.priceTotalCents,
      currency: quote.currency,
      source: input.source ?? "WEB",
      tariffRuleId: quote.ruleId,
      cancellationDeadline: startAt.minus({ hours: 24 }).toJSDate(), // valeur Lot 3 provisoire, configurable au Lot 9
    });

    assertTransition(booking.status, "CHECKOUT_PENDING");
    booking = await this.repo.updateStatus(booking.id, "CHECKOUT_PENDING");

    logger.info({ event: "BookingCheckoutPending", bookingId: booking.id, paymentMode }, "réservation en attente de paiement");
    return booking;
  }

  /** CDC §18.3 — ajout de participants avant paiement (nécessaire pour SPLIT dès le Lot 6, utile aussi en FULL). */
  async addParticipant(input: AddParticipantInput) {
    const booking = await this.repo.findById(input.bookingId);
    if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);
    if (booking.organizerUserId !== input.requestedByUserId) {
      throw new AppError(ErrorCodes.FORBIDDEN, "Seul l'organisateur peut gérer les participants.", 403);
    }
    if (!["DRAFT", "CHECKOUT_PENDING"].includes(booking.status)) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Les participants ne peuvent plus être modifiés pour cette réservation.", 409);
    }

    const court = await this.courtsRepo.findById(booking.courtId);
    const active = booking.participants.filter((p) => p.status !== "REMOVED");
    if (court && active.length + 1 >= court.capacity) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le terrain est déjà complet.", 422);
    }

    return this.repo.addParticipant({
      booking: { connect: { id: booking.id } },
      userId: input.userId,
      legacyClientId: input.legacyClientId,
      invitedEmail: input.invitedEmail,
      displayName: input.displayName,
      role: "PLAYER",
      status: "INVITED",
    });
  }

  async removeParticipant(bookingId: string, requestedByUserId: string, participantId: string) {
    const booking = await this.repo.findById(bookingId);
    if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);
    if (booking.organizerUserId !== requestedByUserId) {
      throw new AppError(ErrorCodes.FORBIDDEN, "Seul l'organisateur peut gérer les participants.", 403);
    }
    if (!["DRAFT", "CHECKOUT_PENDING"].includes(booking.status)) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Les participants ne peuvent plus être modifiés pour cette réservation.", 409);
    }
    const participant = booking.participants.find((p) => p.id === participantId);
    if (!participant) throw new AppError(ErrorCodes.NOT_FOUND, "Participant introuvable.", 404);

    await this.repo.removeParticipant(participantId);
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
