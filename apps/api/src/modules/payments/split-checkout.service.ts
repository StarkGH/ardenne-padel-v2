import { DateTime } from "luxon";
import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import type { CourtsRepository } from "../courts/courts.repository.js";
import type { LegacyBookingProvider } from "../legacy-doinsport/types.js";
import type { BookingsRepository } from "../bookings/bookings.repository.js";
import { createBookingInLegacy } from "../bookings/legacy-booking-sync.js";
import { computeSplitShares } from "../bookings/split-calculator.js";
import type { BookingGuaranteeService } from "../bookings/booking-guarantee.service.js";
import type { BookingShareService } from "../bookings/booking-share.service.js";
import type { WalletService } from "../wallet/wallet.service.js";
import type { AccessGrantService } from "../access/access-grant.service.js";
import type { NotificationService } from "../notifications/notification.service.js";
import { ensureStripeCustomer } from "./ensure-stripe-customer.js";
import type { PaymentsRepository } from "./payments.repository.js";
import type { PaymentProvider } from "./types.js";

export interface SplitCheckoutInput {
  bookingId: string;
  userId: string;
  /** Règle et garantit le paiement de la part organisateur. */
  paymentMethodId: string;
  guaranteeType: "CARD_OFF_SESSION" | "WALLET_RESERVE";
}

export interface SplitCheckoutResult {
  bookingId: string;
  bookingStatus: string;
  organizerShareCents: number;
  guaranteedCents: number;
  shareCount: number;
}

/**
 * CDC §26 : payer la part organisateur + frais éventuel -> créer la garantie
 * -> créer en Legacy -> inviter les autres participants. Séparé de
 * `CheckoutService` (FULL/mixte wallet) car l'ordre des étapes diffère
 * (la garantie est posée *avant* Legacy, pas seulement l'autorisation) et la
 * fusion aurait rendu `CheckoutService` difficile à suivre.
 */
export class SplitCheckoutService {
  constructor(
    private readonly bookingsRepo: BookingsRepository,
    private readonly courtsRepo: CourtsRepository,
    private readonly paymentsRepo: PaymentsRepository,
    private readonly legacyProvider: LegacyBookingProvider,
    private readonly paymentProvider: PaymentProvider,
    private readonly walletService: WalletService,
    private readonly guaranteeService: BookingGuaranteeService,
    private readonly shareService: BookingShareService,
    private readonly config: AppConfig,
    private readonly accessGrantService: AccessGrantService,
    private readonly notificationService: NotificationService,
  ) {}

  async checkout(input: SplitCheckoutInput): Promise<SplitCheckoutResult> {
    const booking = await this.bookingsRepo.findById(input.bookingId);
    if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);
    if (booking.organizerUserId !== input.userId) throw new AppError(ErrorCodes.FORBIDDEN, "Accès refusé.", 403);
    if (booking.status !== "CHECKOUT_PENDING") {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Cette réservation n'est pas en attente de paiement.", 409);
    }
    if (booking.paymentMode !== "SPLIT") {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Cette réservation n'est pas en mode paiement partagé.", 409);
    }

    // CDC §67 : double clic sur le checkout SPLIT — réclamation atomique
    // avant tout appel Stripe, même logique que `CheckoutService` (FULL).
    const claimed = await this.bookingsRepo.transitionStatus(booking.id, "CHECKOUT_PENDING", "PAYMENT_PENDING");
    if (!claimed) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Cette réservation est déjà en cours de traitement.", 409);
    }

    const court = await this.courtsRepo.findById(booking.courtId);
    if (!court) throw new Error(`SplitCheckoutService: terrain ${booking.courtId} introuvable`);

    const others = booking.participants.filter((p) => p.status !== "REMOVED");
    const participantCount = others.length + 1; // + organisateur
    if (participantCount < 2) {
      await this.bookingsRepo.updateStatus(booking.id, "CHECKOUT_PENDING"); // réclamé plus haut, aucun effet externe encore produit
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "Il faut au moins un autre participant pour un paiement partagé.",
        422,
      );
    }
    if (participantCount > court.capacity) {
      await this.bookingsRepo.updateStatus(booking.id, "CHECKOUT_PENDING");
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le nombre de participants dépasse la capacité du terrain.", 422);
    }

    const serviceFeeCents = this.config.SPLIT_SERVICE_FEE_ENABLED ? this.config.SPLIT_SERVICE_FEE_CENTS : 0;
    const shares = computeSplitShares({
      basePriceTotalCents: booking.bookingBasePriceCents,
      participantCount,
      serviceFeeCents,
      allocation: this.config.SPLIT_SERVICE_FEE_ALLOCATION,
    });
    const organizerShare = shares[0]!;
    const guaranteedCents = shares.slice(1).reduce((sum, s) => sum + s.totalAmountCents, 0);

    // 1. Payer immédiatement la part organisateur (+ frais si allocation ORGANIZER, CDC §26 étape 2).
    let authorized: Awaited<ReturnType<PaymentProvider["createPayment"]>>;
    try {
      const customer = await ensureStripeCustomer(this.paymentsRepo, this.paymentProvider, input.userId);
      authorized = await this.paymentProvider.createPayment({
        customerId: customer.customerId,
        amountCents: organizerShare.totalAmountCents,
        currency: booking.currency,
        paymentMethodId: input.paymentMethodId,
        idempotencyKey: `split-organizer:${booking.id}`,
      });
    } catch (err) {
      // CDC §68 : filet de sécurité pour une exception non anticipée (timeout
      // Stripe...) avant toute autorisation connue — transition
      // conditionnelle, réservation reclaimable.
      await this.bookingsRepo.transitionStatus(booking.id, "PAYMENT_PENDING", "CHECKOUT_PENDING");
      throw err;
    }
    if (authorized.status === "failed") {
      await this.bookingsRepo.updateStatus(booking.id, "CHECKOUT_PENDING");
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le paiement de votre part n'a pas pu être validé.", 402);
    }
    if (authorized.status === "requires_action") {
      // CDC §26 suppose un parcours synchrone pour l'organisateur (contrairement
      // au FULL, pas de reprise webhook ici au Lot 6 — limitation documentée).
      await this.paymentProvider.voidAuthorization({ providerPaymentId: authorized.providerPaymentId }).catch(() => undefined);
      await this.bookingsRepo.updateStatus(booking.id, "CHECKOUT_PENDING");
      throw new AppError(
        "3DS_REQUIRED_UNSUPPORTED_FOR_SPLIT",
        "Ce moyen de paiement nécessite une authentification supplémentaire, non prise en charge pour le paiement partagé pour l'instant.",
        422,
      );
    }

    let organizerPayment: Awaited<ReturnType<PaymentsRepository["createPayment"]>>;
    try {
      organizerPayment = await this.paymentsRepo.createPayment({
        booking: { connect: { id: booking.id } },
        user: { connect: { id: input.userId } },
        provider: "stripe",
        providerPaymentId: authorized.providerPaymentId,
        paymentChannel: "ONLINE",
        paymentMethodType: authorized.paymentMethodType,
        amountCents: organizerShare.totalAmountCents,
        currency: booking.currency,
        status: "AUTHORIZED",
        purpose: "BOOKING_FULL",
      });
    } catch (err) {
      // L'autorisation Stripe a réussi mais son enregistrement en base a
      // échoué : ne jamais laisser une autorisation orpheline (CDC §68).
      await this.paymentProvider.voidAuthorization({ providerPaymentId: authorized.providerPaymentId }).catch(() => undefined);
      await this.bookingsRepo.transitionStatus(booking.id, "PAYMENT_PENDING", "CHECKOUT_PENDING");
      throw err;
    }

    // 2. Créer la garantie (CDC §25, un seul mécanisme actif — §25.3).
    if (input.guaranteeType === "WALLET_RESERVE") {
      const wallet = await this.walletService.ensureAccount(input.userId);
      await this.guaranteeService.createWalletGuarantee({
        bookingId: booking.id,
        organizerUserId: input.userId,
        walletAccountId: wallet.id,
        amountCents: guaranteedCents,
      });
    } else {
      await this.guaranteeService.createCardGuarantee({
        bookingId: booking.id,
        organizerUserId: input.userId,
        amountCents: guaranteedCents,
        paymentMethodId: input.paymentMethodId,
      });
    }

    // 3. Créer en Legacy (même séquence de sécurité que le FULL — CDC §27.1).
    let legacyAccessCodes: Array<{ code?: string; playgroundName?: string }> | undefined;
    try {
      if (this.config.LEGACY_WRITE_ENABLED) {
        const correlationMarker = `APV2:${booking.id}`;
        if (!booking.legacyBookingMapping) {
          await this.bookingsRepo.createLegacyMapping(booking.id, correlationMarker);
        }
        const legacyResult = await createBookingInLegacy(this.bookingsRepo, this.legacyProvider, this.config, {
          bookingId: booking.id,
          organizerUserId: booking.organizerUserId,
          court,
          startAt: DateTime.fromJSDate(booking.startAt, { zone: "utc" }),
          endAt: DateTime.fromJSDate(booking.endAt, { zone: "utc" }),
          durationMinutes: booking.durationMinutes,
          v2PriceTotalCents: organizerShare.totalAmountCents + guaranteedCents,
          correlationMarker,
        });
        legacyAccessCodes = legacyResult.accessCodes;
      }
    } catch (err) {
      if (err instanceof AppError && err.code === "BOOKING_SLOT_UNAVAILABLE") {
        await this.paymentProvider.voidAuthorization({ providerPaymentId: authorized.providerPaymentId });
        await this.paymentsRepo.updatePaymentStatus(organizerPayment.id, { status: "CANCELED" });
        await this.guaranteeService.releaseEntirely(booking.id);
        await this.bookingsRepo.updateStatus(booking.id, "FAILED");
        throw err;
      }
      await this.bookingsRepo.updateStatus(booking.id, "MANUAL_REVIEW");
      logger.error({ event: "LegacyBookingCreationFailed", bookingId: booking.id, err }, "création Legacy en échec (SPLIT), MANUAL_REVIEW");
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "La réservation n'a pas pu être confirmée pour le moment.", 502);
    }

    // 4. Capturer la part organisateur et confirmer. Legacy a déjà confirmé
    // à ce stade : une capture qui échoue OU qui lève une exception (timeout
    // Stripe pendant la capture, CDC §68) doit produire MANUAL_REVIEW dans
    // les deux cas, jamais un FAILED silencieux — l'argent est peut-être
    // déjà bloqué côté Stripe alors que Legacy est confirmé.
    let captureSucceeded: boolean;
    try {
      const captured = await this.paymentProvider.confirmOrCapture({ providerPaymentId: authorized.providerPaymentId });
      captureSucceeded = captured.status === "succeeded";
    } catch (err) {
      logger.error({ event: "CaptureThrewAfterLegacy", bookingId: booking.id, err }, "exception pendant la capture Stripe après confirmation Legacy (SPLIT)");
      captureSucceeded = false;
    }
    if (!captureSucceeded) {
      await this.paymentsRepo.updatePaymentStatus(organizerPayment.id, { status: "FAILED" });
      await this.bookingsRepo.updateStatus(booking.id, "MANUAL_REVIEW");
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "La réservation n'a pas pu être confirmée pour le moment.", 502);
    }
    await this.paymentsRepo.updatePaymentStatus(organizerPayment.id, { status: "SUCCEEDED" });

    const confirmed = await this.bookingsRepo.updateStatus(booking.id, "CONFIRMED", {
      paymentStatus: "PARTIALLY_PAID", // seule la part organisateur est réglée à ce stade (CDC §17)
      confirmedAt: new Date(),
    });

    // 5. Créer les parts et inviter les autres participants (CDC §26 étape 4).
    await this.shareService.createSharesAndInvite({
      bookingId: booking.id,
      organizerUserId: input.userId,
      organizerPaymentId: organizerPayment.id,
      shares,
      participants: others.map((p) => ({
        userId: p.userId ?? undefined,
        legacyClientId: p.legacyClientId ?? undefined,
        invitedEmail: p.invitedEmail ?? undefined,
      })),
    });

    logger.info({ event: "BookingConfirmed", bookingId: booking.id, mode: "SPLIT" }, "réservation SPLIT confirmée");

    await this.accessGrantService.provisionOrImportForBooking(confirmed, legacyAccessCodes).catch((err) => {
      logger.error({ event: "AccessGrantAutomationFailed", bookingId: booking.id, err }, "automatisme d'accès en échec");
    });
    await this.notificationService
      .enqueue({
        template: "BOOKING_CONFIRMATION",
        recipientUserId: confirmed.organizerUserId,
        payload: { bookingId: confirmed.id, startAt: confirmed.startAt.toISOString(), mode: "SPLIT" },
      })
      .catch((err) => logger.error({ event: "NotificationEnqueueFailed", bookingId: booking.id, err }, "échec d'enqueue notification"));
    const reminderAt = new Date(confirmed.startAt.getTime() - this.config.BOOKING_REMINDER_LEAD_MINUTES * 60_000);
    if (reminderAt.getTime() > Date.now()) {
      await this.notificationService
        .enqueue({
          template: "BOOKING_REMINDER",
          recipientUserId: confirmed.organizerUserId,
          payload: { bookingId: confirmed.id, startAt: confirmed.startAt.toISOString() },
          scheduledFor: reminderAt,
        })
        .catch((err) => logger.error({ event: "NotificationEnqueueFailed", bookingId: booking.id, err }, "échec d'enqueue rappel"));
    }

    return {
      bookingId: booking.id,
      bookingStatus: confirmed.status,
      organizerShareCents: organizerShare.totalAmountCents,
      guaranteedCents,
      shareCount: shares.length,
    };
  }
}
