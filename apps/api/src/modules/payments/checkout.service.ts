import { DateTime } from "luxon";
import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import type { PaymentTransactionStatus } from "@prisma/client";
import type { CourtsRepository } from "../courts/courts.repository.js";
import type { LegacyBookingProvider } from "../legacy-doinsport/types.js";
import type { BookingsRepository } from "../bookings/bookings.repository.js";
import { createBookingInLegacy } from "../bookings/legacy-booking-sync.js";
import type { PaymentsRepository } from "./payments.repository.js";
import type { PaymentIntentStatus, PaymentProvider } from "./types.js";

export interface CheckoutInput {
  bookingId: string;
  userId: string;
  paymentMethodId: string;
}

export interface CheckoutResult {
  bookingId: string;
  bookingStatus: string;
  paymentId: string;
  requiresAction: boolean;
  clientSecret?: string;
}

function toTransactionStatus(status: PaymentIntentStatus): PaymentTransactionStatus {
  switch (status) {
    case "requires_action":
      return "REQUIRES_ACTION";
    case "requires_capture":
      return "AUTHORIZED";
    case "succeeded":
      return "SUCCEEDED";
    case "canceled":
      return "CANCELED";
    default:
      return "FAILED";
  }
}

/**
 * Orchestration paiement + Legacy (CDC §27.1) : autoriser (capture manuelle)
 * -> créer en Legacy -> capturer seulement si Legacy confirme. Réutilisable
 * de façon synchrone (`checkout`) ou asynchrone via webhook après 3D Secure
 * (`continueAfterAuthorizationConfirmed`) — les deux convergent vers
 * `proceedAfterAuthorization`, il n'existe qu'un seul chemin vers `CONFIRMED`.
 */
export class CheckoutService {
  constructor(
    private readonly bookingsRepo: BookingsRepository,
    private readonly courtsRepo: CourtsRepository,
    private readonly paymentsRepo: PaymentsRepository,
    private readonly legacyProvider: LegacyBookingProvider,
    private readonly paymentProvider: PaymentProvider,
    private readonly config: AppConfig,
  ) {}

  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    const booking = await this.bookingsRepo.findById(input.bookingId);
    if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);
    if (booking.organizerUserId !== input.userId) {
      throw new AppError(ErrorCodes.FORBIDDEN, "Accès refusé.", 403);
    }
    if (booking.status !== "CHECKOUT_PENDING") {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Cette réservation n'est pas en attente de paiement.", 409);
    }

    const user = await this.paymentsRepo.findUserForPayment(input.userId);
    if (!user) throw new AppError(ErrorCodes.NOT_FOUND, "Utilisateur introuvable.", 404);

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.paymentProvider.createCustomer({ userId: user.id, email: user.email });
      customerId = customer.customerId;
      await this.paymentsRepo.updateUserStripeCustomerId(user.id, customerId);
    }

    // CDC §47.1 : idempotency key déterministe par booking — un double clic
    // rejoue la même autorisation plutôt que d'en créer une seconde.
    const paymentRef = await this.paymentProvider.createPayment({
      customerId,
      amountCents: booking.priceTotalCents,
      currency: booking.currency,
      paymentMethodId: input.paymentMethodId,
      idempotencyKey: `checkout:${booking.id}`,
    });

    const payment = await this.paymentsRepo.createPayment({
      booking: { connect: { id: booking.id } },
      user: { connect: { id: user.id } },
      provider: "stripe",
      providerPaymentId: paymentRef.providerPaymentId,
      paymentChannel: "ONLINE",
      paymentMethodType: paymentRef.paymentMethodType,
      amountCents: booking.priceTotalCents,
      currency: booking.currency,
      status: toTransactionStatus(paymentRef.status),
      purpose: "BOOKING_FULL",
    });

    if (paymentRef.status === "failed") {
      await this.bookingsRepo.updateStatus(booking.id, "FAILED");
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "Le paiement n'a pas pu être validé. La réservation n'est pas confirmée.",
        402,
      );
    }

    if (paymentRef.status === "requires_action") {
      // CDC §44 : le webhook est la source de vérité pour la suite (3D Secure
      // se termine côté client, puis Stripe notifie de façon asynchrone).
      return {
        bookingId: booking.id,
        bookingStatus: booking.status,
        paymentId: payment.id,
        requiresAction: true,
        clientSecret: paymentRef.clientSecret,
      };
    }

    await this.bookingsRepo.updateStatus(booking.id, "PAYMENT_PENDING");
    const finalBooking = await this.proceedAfterAuthorization(booking.id, payment.id, payment.providerPaymentId);
    return {
      bookingId: booking.id,
      bookingStatus: finalBooking.status,
      paymentId: payment.id,
      requiresAction: false,
    };
  }

  /** Point d'entrée webhook (`payment_intent.amount_capturable_updated`) — 3DS terminé côté client. */
  async continueAfterAuthorizationConfirmed(providerPaymentId: string): Promise<void> {
    const payment = await this.paymentsRepo.findPaymentByProviderPaymentId(providerPaymentId);
    if (!payment || !payment.bookingId) return;
    if (payment.status !== "REQUIRES_ACTION") return; // déjà traité (idempotence webhook, CDC §44)

    await this.paymentsRepo.updatePaymentStatus(payment.id, { status: "AUTHORIZED" });
    await this.bookingsRepo.updateStatus(payment.bookingId, "PAYMENT_PENDING");
    await this.proceedAfterAuthorization(payment.bookingId, payment.id, providerPaymentId);
  }

  /** Point d'entrée webhook (`payment_intent.payment_failed`). */
  async handlePaymentFailedViaWebhook(providerPaymentId: string): Promise<void> {
    const payment = await this.paymentsRepo.findPaymentByProviderPaymentId(providerPaymentId);
    if (!payment) return;
    if (payment.status === "SUCCEEDED" || payment.status === "FAILED") return; // idempotence

    await this.paymentsRepo.updatePaymentStatus(payment.id, { status: "FAILED" });
    if (payment.bookingId) {
      const booking = await this.bookingsRepo.findById(payment.bookingId);
      if (booking && !["FAILED", "CANCELED", "CONFIRMED", "COMPLETED"].includes(booking.status)) {
        await this.bookingsRepo.updateStatus(booking.id, "FAILED");
      }
    }
  }

  /**
   * Suite commune (CDC §27.1) : créer en Legacy si activé, puis capturer.
   * Jamais appelée avec un paiement non autorisé.
   */
  private async proceedAfterAuthorization(bookingId: string, paymentId: string, providerPaymentId: string) {
    const booking = await this.bookingsRepo.findById(bookingId);
    if (!booking) throw new Error(`proceedAfterAuthorization: booking ${bookingId} introuvable`);
    const court = await this.courtsRepo.findById(booking.courtId);
    if (!court) throw new Error(`proceedAfterAuthorization: terrain ${booking.courtId} introuvable`);

    if (this.config.LEGACY_WRITE_ENABLED) {
      const correlationMarker = `APV2:${booking.id}`;
      if (!booking.legacyBookingMapping) {
        await this.bookingsRepo.createLegacyMapping(booking.id, correlationMarker);
      }

      try {
        await createBookingInLegacy(this.bookingsRepo, this.legacyProvider, this.config, {
          bookingId: booking.id,
          organizerUserId: booking.organizerUserId,
          court,
          startAt: DateTime.fromJSDate(booking.startAt, { zone: "utc" }),
          endAt: DateTime.fromJSDate(booking.endAt, { zone: "utc" }),
          durationMinutes: booking.durationMinutes,
          v2PriceTotalCents: booking.priceTotalCents,
          correlationMarker,
        });
      } catch (err) {
        if (err instanceof AppError && err.code === "BOOKING_SLOT_UNAVAILABLE") {
          // CDC §27.1 : "Libérer/annuler autorisation" en cas de collision.
          await this.paymentProvider.voidAuthorization({ providerPaymentId });
          await this.paymentsRepo.updatePaymentStatus(paymentId, { status: "CANCELED" });
          await this.bookingsRepo.updateStatus(booking.id, "FAILED");
          await this.bookingsRepo
            .updateLegacyMapping(booking.id, { syncStatus: "FAILED", lastError: err.message })
            .catch(() => undefined);
          throw err;
        }
        // Erreur ambiguë (timeout, 5xx...) : ne jamais voider aveuglément
        // (CDC §16.2 — l'état Legacy réel est peut-être confirmé). Le
        // paiement reste AUTHORIZED, un admin tranche (Lot 9).
        await this.bookingsRepo.updateStatus(booking.id, "MANUAL_REVIEW");
        await this.bookingsRepo
          .updateLegacyMapping(booking.id, {
            syncStatus: "CONFIRMATION_UNKNOWN",
            lastError: err instanceof Error ? err.message : String(err),
          })
          .catch(() => undefined);
        logger.error({ event: "LegacyBookingCreationFailed", bookingId: booking.id, err }, "création Legacy en échec, MANUAL_REVIEW");
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "La réservation n'a pas pu être confirmée pour le moment.", 502);
      }
    }

    const captured = await this.paymentProvider.confirmOrCapture({ providerPaymentId });
    if (captured.status !== "succeeded") {
      // Legacy confirmé (ou non requis) mais la capture échoue : argent non
      // prélevé, créneau potentiellement réservé -> jamais un FAILED silencieux.
      await this.paymentsRepo.updatePaymentStatus(paymentId, { status: "FAILED" });
      await this.bookingsRepo.updateStatus(booking.id, "MANUAL_REVIEW");
      logger.error({ event: "CaptureFailedAfterLegacy", bookingId: booking.id }, "capture Stripe en échec après confirmation Legacy");
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "La réservation n'a pas pu être confirmée pour le moment.", 502);
    }

    await this.paymentsRepo.updatePaymentStatus(paymentId, { status: "SUCCEEDED" });
    const confirmed = await this.bookingsRepo.updateStatus(booking.id, "CONFIRMED", {
      paymentStatus: "PAID",
      confirmedAt: new Date(),
    });
    logger.info({ event: "BookingConfirmed", bookingId: booking.id }, "réservation confirmée (paiement capturé)");
    return confirmed;
  }
}
