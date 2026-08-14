import { DateTime } from "luxon";
import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import type { PaymentTransactionStatus } from "@prisma/client";
import type { CourtsRepository } from "../courts/courts.repository.js";
import type { LegacyBookingProvider } from "../legacy-doinsport/types.js";
import type { BookingsRepository } from "../bookings/bookings.repository.js";
import { createBookingInLegacy } from "../bookings/legacy-booking-sync.js";
import type { WalletService } from "../wallet/wallet.service.js";
import type { WalletRepository } from "../wallet/wallet.repository.js";
import { ensureStripeCustomer } from "./ensure-stripe-customer.js";
import type { PaymentsRepository } from "./payments.repository.js";
import type { PaymentIntentStatus, PaymentProvider } from "./types.js";

export interface CheckoutInput {
  bookingId: string;
  userId: string;
  /** Requis seulement si le wallet ne couvre pas la totalité du prix. */
  paymentMethodId?: string;
  /** CDC §27.3, §28.7 — montant de crédits à appliquer (0 ou absent = pas de wallet). */
  applyWalletCents?: number;
}

export interface CheckoutResult {
  bookingId: string;
  bookingStatus: string;
  paymentId?: string;
  walletAppliedCents: number;
  requiresAction: boolean;
  clientSecret?: string;
}

/** Les deux "jambes" de financement d'une réservation — l'une, l'autre, ou les deux (CDC §28.7). */
interface FundingLegs {
  walletHoldId?: string;
  paymentId?: string;
  providerPaymentId?: string;
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
 * Orchestration paiement + Legacy (CDC §27.1, §27.3) : autoriser (Stripe en
 * capture manuelle et/ou hold wallet) -> créer en Legacy -> capturer
 * seulement si Legacy confirme. Réutilisable de façon synchrone
 * (`checkout`) ou asynchrone via webhook après 3D Secure
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
    private readonly walletService: WalletService,
    private readonly walletRepo: WalletRepository,
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

    let walletAppliedCents = 0;
    let walletHoldId: string | undefined;

    if (input.applyWalletCents && input.applyWalletCents > 0) {
      const wallet = await this.walletService.ensureAccount(input.userId);
      const balance = await this.walletService.getBalance(wallet.id);
      walletAppliedCents = Math.min(input.applyWalletCents, balance.availableCents, booking.priceTotalCents);
      if (walletAppliedCents > 0) {
        const hold = await this.walletService.createHold({
          walletAccountId: wallet.id,
          bookingId: booking.id,
          amountCents: walletAppliedCents,
        });
        walletHoldId = hold.id;
      }
    }

    const remainingCents = booking.priceTotalCents - walletAppliedCents;

    if (remainingCents === 0) {
      // CDC §28.7 : 100% wallet — aucune transaction Stripe créée (§28.8).
      await this.bookingsRepo.updateStatus(booking.id, "PAYMENT_PENDING");
      const finalBooking = await this.proceedAfterAuthorization(booking.id, { walletHoldId });
      return { bookingId: booking.id, bookingStatus: finalBooking.status, walletAppliedCents, requiresAction: false };
    }

    if (!input.paymentMethodId) {
      if (walletHoldId) await this.walletService.releaseHold(walletHoldId);
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "Un moyen de paiement est requis pour le solde restant après application du wallet.",
        422,
      );
    }

    const customer = await ensureStripeCustomer(this.paymentsRepo, this.paymentProvider, input.userId);

    // CDC §47.1 : idempotency key déterministe par booking — un double clic
    // rejoue la même autorisation plutôt que d'en créer une seconde.
    const paymentRef = await this.paymentProvider.createPayment({
      customerId: customer.customerId,
      amountCents: remainingCents,
      currency: booking.currency,
      paymentMethodId: input.paymentMethodId,
      idempotencyKey: `checkout:${booking.id}`,
    });

    const payment = await this.paymentsRepo.createPayment({
      booking: { connect: { id: booking.id } },
      user: { connect: { id: input.userId } },
      provider: "stripe",
      providerPaymentId: paymentRef.providerPaymentId,
      paymentChannel: "ONLINE",
      paymentMethodType: paymentRef.paymentMethodType,
      amountCents: remainingCents,
      currency: booking.currency,
      status: toTransactionStatus(paymentRef.status),
      purpose: "BOOKING_FULL",
    });

    if (paymentRef.status === "failed") {
      if (walletHoldId) await this.walletService.releaseHold(walletHoldId);
      await this.bookingsRepo.updateStatus(booking.id, "FAILED");
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "Le paiement n'a pas pu être validé. La réservation n'est pas confirmée.",
        402,
      );
    }

    if (paymentRef.status === "requires_action") {
      // CDC §44 : le webhook est la source de vérité pour la suite (3D Secure
      // se termine côté client, puis Stripe notifie de façon asynchrone). Le
      // hold wallet éventuel reste ACTIVE, retrouvable via `booking.id`.
      return {
        bookingId: booking.id,
        bookingStatus: booking.status,
        paymentId: payment.id,
        walletAppliedCents,
        requiresAction: true,
        clientSecret: paymentRef.clientSecret,
      };
    }

    await this.bookingsRepo.updateStatus(booking.id, "PAYMENT_PENDING");
    const finalBooking = await this.proceedAfterAuthorization(booking.id, {
      walletHoldId,
      paymentId: payment.id,
      providerPaymentId: payment.providerPaymentId,
    });
    return {
      bookingId: booking.id,
      bookingStatus: finalBooking.status,
      paymentId: payment.id,
      walletAppliedCents,
      requiresAction: false,
    };
  }

  /** Point d'entrée webhook (`payment_intent.amount_capturable_updated`) — 3DS terminé côté client. */
  async continueAfterAuthorizationConfirmed(providerPaymentId: string): Promise<void> {
    const payment = await this.paymentsRepo.findPaymentByProviderPaymentId(providerPaymentId);
    if (!payment || !payment.bookingId) return;
    if (payment.status !== "REQUIRES_ACTION") return; // déjà traité (idempotence webhook, CDC §44)

    const hold = await this.walletRepo.findActiveHoldForBooking(payment.bookingId);

    await this.paymentsRepo.updatePaymentStatus(payment.id, { status: "AUTHORIZED" });
    await this.bookingsRepo.updateStatus(payment.bookingId, "PAYMENT_PENDING");
    await this.proceedAfterAuthorization(payment.bookingId, {
      walletHoldId: hold?.id,
      paymentId: payment.id,
      providerPaymentId,
    });
  }

  /** Point d'entrée webhook (`payment_intent.payment_failed`). */
  async handlePaymentFailedViaWebhook(providerPaymentId: string): Promise<void> {
    const payment = await this.paymentsRepo.findPaymentByProviderPaymentId(providerPaymentId);
    if (!payment) return;
    if (payment.status === "SUCCEEDED" || payment.status === "FAILED") return; // idempotence

    await this.paymentsRepo.updatePaymentStatus(payment.id, { status: "FAILED" });
    if (payment.bookingId) {
      const hold = await this.walletRepo.findActiveHoldForBooking(payment.bookingId);
      if (hold) await this.walletService.releaseHold(hold.id);

      const booking = await this.bookingsRepo.findById(payment.bookingId);
      if (booking && !["FAILED", "CANCELED", "CONFIRMED", "COMPLETED"].includes(booking.status)) {
        await this.bookingsRepo.updateStatus(booking.id, "FAILED");
      }
    }
  }

  /**
   * Suite commune (CDC §27.1, §27.3) : créer en Legacy si activé, puis
   * capturer les jambes de financement actives (Stripe et/ou wallet).
   * Jamais appelée sans qu'au moins une jambe soit autorisée/réservée.
   */
  private async proceedAfterAuthorization(bookingId: string, legs: FundingLegs) {
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
          // CDC §27.1 : "Libérer/annuler autorisation" en cas de collision —
          // vaut pour les deux jambes de financement.
          if (legs.providerPaymentId) {
            await this.paymentProvider.voidAuthorization({ providerPaymentId: legs.providerPaymentId });
            if (legs.paymentId) await this.paymentsRepo.updatePaymentStatus(legs.paymentId, { status: "CANCELED" });
          }
          if (legs.walletHoldId) await this.walletService.releaseHold(legs.walletHoldId);
          await this.bookingsRepo.updateStatus(booking.id, "FAILED");
          await this.bookingsRepo
            .updateLegacyMapping(booking.id, { syncStatus: "FAILED", lastError: err.message })
            .catch(() => undefined);
          throw err;
        }
        // Erreur ambiguë (timeout, 5xx...) : ne jamais voider/libérer
        // aveuglément (CDC §16.2 — l'état Legacy réel est peut-être
        // confirmé). Les deux jambes restent verrouillées, un admin tranche.
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

    if (legs.providerPaymentId && legs.paymentId) {
      const captured = await this.paymentProvider.confirmOrCapture({ providerPaymentId: legs.providerPaymentId });
      if (captured.status !== "succeeded") {
        // Legacy confirmé (ou non requis) mais la capture échoue : argent non
        // prélevé, créneau potentiellement réservé -> jamais un FAILED silencieux.
        // Le hold wallet éventuel reste lui aussi verrouillé, pas capturé,
        // tant que la situation n'est pas résolue.
        await this.paymentsRepo.updatePaymentStatus(legs.paymentId, { status: "FAILED" });
        await this.bookingsRepo.updateStatus(booking.id, "MANUAL_REVIEW");
        logger.error({ event: "CaptureFailedAfterLegacy", bookingId: booking.id }, "capture Stripe en échec après confirmation Legacy");
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "La réservation n'a pas pu être confirmée pour le moment.", 502);
      }
      await this.paymentsRepo.updatePaymentStatus(legs.paymentId, { status: "SUCCEEDED" });
    }

    if (legs.walletHoldId) {
      await this.walletService.captureHold(legs.walletHoldId);
    }

    const confirmed = await this.bookingsRepo.updateStatus(booking.id, "CONFIRMED", {
      paymentStatus: "PAID",
      confirmedAt: new Date(),
    });
    logger.info({ event: "BookingConfirmed", bookingId: booking.id }, "réservation confirmée (paiement capturé)");
    return confirmed;
  }
}
