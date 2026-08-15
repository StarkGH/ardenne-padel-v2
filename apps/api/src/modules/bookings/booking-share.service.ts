import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import { generateOpaqueToken, hashToken } from "../identity/tokens.js";
import { ensureStripeCustomer } from "../payments/ensure-stripe-customer.js";
import type { PaymentsRepository } from "../payments/payments.repository.js";
import type { PaymentProvider } from "../payments/types.js";
import type { WalletService } from "../wallet/wallet.service.js";
import type { EmailSender } from "../identity/email-sender.js";
import type { NotificationService } from "../notifications/notification.service.js";
import type { BookingsRepository } from "./bookings.repository.js";
import type { BookingGuaranteeService } from "./booking-guarantee.service.js";
import type { BookingShareRepository } from "./booking-share.repository.js";
import type { SplitShare } from "./split-calculator.js";

export interface ShareParticipant {
  userId?: string;
  legacyClientId?: string;
  invitedEmail?: string;
}

/**
 * CDC §26 — parts de réservation et paiements invités. La part de
 * l'organisateur (`shares[0]`, voir `split-calculator.ts`) est créée déjà
 * `PAID` — c'est `CheckoutService` qui l'a réglée avant d'appeler ce service.
 */
export class BookingShareService {
  constructor(
    private readonly repo: BookingShareRepository,
    private readonly bookingsRepo: BookingsRepository,
    private readonly paymentsRepo: PaymentsRepository,
    private readonly walletService: WalletService,
    private readonly paymentProvider: PaymentProvider,
    private readonly guaranteeService: BookingGuaranteeService,
    private readonly emailSender: EmailSender,
    private readonly config: AppConfig,
    private readonly notificationService: NotificationService,
  ) {}

  /** Crée toutes les parts (organisateur inclus, déjà payée) et invite les autres participants. */
  async createSharesAndInvite(input: {
    bookingId: string;
    organizerUserId: string;
    organizerPaymentId?: string;
    shares: SplitShare[];
    participants: ShareParticipant[]; // un de moins que `shares` : le premier `shares[0]` est l'organisateur
  }): Promise<void> {
    if (input.participants.length !== input.shares.length - 1) {
      throw new Error("createSharesAndInvite: le nombre de participants doit correspondre au nombre de parts - 1 (organisateur)");
    }

    // `createMany` s'exécute en un seul INSERT : `now()` y est évalué une
    // seule fois pour toutes les lignes (sémantique Postgres), donc un
    // `createdAt` implicite identique pour les 4 parts -> tri
    // `orderBy: createdAt` non déterministe entre elles. On force un
    // `createdAt` explicite et strictement croissant (organisateur en
    // premier) pour que `listForBooking`/`shares[0]` reste fiable.
    const baseTimestamp = Date.now();
    const organizerShare = input.shares[0]!;
    const rows = [
      {
        id: randomUUID(),
        bookingId: input.bookingId,
        participantUserId: input.organizerUserId,
        baseAmountCents: organizerShare.baseAmountCents,
        serviceFeeAmountCents: organizerShare.serviceFeeAmountCents,
        totalAmountCents: organizerShare.totalAmountCents,
        status: "PAID" as const,
        paidByUserId: input.organizerUserId,
        paymentId: input.organizerPaymentId,
        paidAt: new Date(),
        createdAt: new Date(baseTimestamp),
      },
      ...input.shares.slice(1).map((share, i) => ({
        id: randomUUID(),
        bookingId: input.bookingId,
        participantUserId: input.participants[i]!.userId,
        legacyClientId: input.participants[i]!.legacyClientId,
        invitedEmail: input.participants[i]!.invitedEmail,
        baseAmountCents: share.baseAmountCents,
        serviceFeeAmountCents: share.serviceFeeAmountCents,
        totalAmountCents: share.totalAmountCents,
        status: "OPEN" as const,
        createdAt: new Date(baseTimestamp + i + 1),
      })),
    ];
    await this.repo.createMany(rows);

    for (let i = 0; i < input.participants.length; i++) {
      const participant = input.participants[i]!;
      const shareId = rows[i + 1]!.id;
      if (participant.invitedEmail) {
        await this.sendInvitation(shareId, participant.invitedEmail);
      }
    }
  }

  private async sendInvitation(shareId: string, email: string): Promise<void> {
    const { raw, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.SPLIT_INVITATION_TTL_HOURS * 3600_000);
    await this.repo.setInvitation(shareId, hash, expiresAt);

    const url = `${this.config.PUBLIC_BASE_URL}/booking-shares/${raw}`;
    await this.emailSender.sendSplitInvitationEmail(email, url);
    logger.info({ event: "SplitInvitationSent", shareId }, "invitation de paiement partagé envoyée");
  }

  async getShareByToken(rawToken: string) {
    const share = await this.repo.findByTokenHash(hashToken(rawToken));
    if (!share) throw new AppError(ErrorCodes.NOT_FOUND, "Invitation introuvable.", 404);
    if (share.invitationExpiresAt && share.invitationExpiresAt < new Date()) {
      throw new AppError("INVITATION_EXPIRED", "Ce lien d'invitation a expiré.", 410);
    }
    return share;
  }

  /** CDC §26.3 — le paiement d'une part requiert un compte Ardenne Padel actif. */
  async payShare(input: { rawToken: string; payerUserId: string; fundingSource: "WALLET" | "EXTERNAL"; paymentMethodId?: string }) {
    const share = await this.getShareByToken(input.rawToken);
    if (share.status === "PAID") {
      throw new AppError("SHARE_ALREADY_PAID", "Cette participation a déjà été réglée.", 409);
    }
    if (!["OPEN", "INVITED"].includes(share.status)) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Cette participation ne peut plus être payée.", 409);
    }

    // CDC §67 : deux paiements concurrents de la même part — réclamation
    // atomique avant tout débit/charge, pour qu'une seule requête puisse
    // aller jusqu'au prélèvement (wallet ou Stripe).
    const claimed = await this.repo.claimForPayment(share.id);
    if (!claimed) {
      throw new AppError("SHARE_ALREADY_PAID", "Cette participation a déjà été réglée.", 409);
    }

    let paymentId: string | undefined;
    let walletTransactionRef: string | undefined;

    try {
      if (input.fundingSource === "WALLET") {
        const wallet = await this.walletService.ensureAccount(input.payerUserId);
        await this.walletService.debitForBooking({
          walletAccountId: wallet.id,
          bookingId: share.bookingId,
          amountCents: share.totalAmountCents,
        });
        walletTransactionRef = wallet.id;
      } else {
        if (!input.paymentMethodId) {
          throw new AppError(ErrorCodes.VALIDATION_FAILED, "Un moyen de paiement est requis.", 422);
        }
        const customer = await ensureStripeCustomer(this.paymentsRepo, this.paymentProvider, input.payerUserId);
        const authorized = await this.paymentProvider.createPayment({
          customerId: customer.customerId,
          amountCents: share.totalAmountCents,
          currency: "EUR",
          paymentMethodId: input.paymentMethodId,
          idempotencyKey: `share:${share.id}`,
        });
        if (authorized.status === "failed") {
          throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le paiement n'a pas pu être validé.", 402);
        }
        const payment = await this.paymentsRepo.createPayment({
          user: { connect: { id: input.payerUserId } },
          booking: { connect: { id: share.bookingId } },
          provider: "stripe",
          providerPaymentId: authorized.providerPaymentId,
          paymentChannel: "ONLINE",
          paymentMethodType: authorized.paymentMethodType,
          amountCents: share.totalAmountCents,
          currency: "EUR",
          status: authorized.status === "requires_capture" ? "AUTHORIZED" : "SUCCEEDED",
          purpose: "BOOKING_SHARE",
        });
        if (authorized.status === "requires_capture") {
          const captured = await this.paymentProvider.confirmOrCapture({ providerPaymentId: authorized.providerPaymentId });
          if (captured.status !== "succeeded") {
            await this.paymentsRepo.updatePaymentStatus(payment.id, { status: "FAILED" });
            throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le paiement n'a pas pu être capturé.", 402);
          }
          await this.paymentsRepo.updatePaymentStatus(payment.id, { status: "SUCCEEDED" });
        }
        paymentId = payment.id;
      }
    } catch (err) {
      // Le débit/l'autorisation a échoué après réclamation atomique : la part
      // redevient payable (aucun argent n'a effectivement changé de main du
      // point de vue de ce participant) plutôt que de rester bloquée en
      // PAYMENT_PENDING indéfiniment.
      await this.repo.updateStatus(share.id, share.status);
      throw err;
    }

    // Transition atomique : un lien d'invitation devient inutilisable après paiement (CDC §26.2).
    const marked = await this.repo.markPaidIfPayable(share.id, {
      status: "PAID",
      fundingSource: input.fundingSource,
      paidByUserId: input.payerUserId,
      paymentId,
      walletTransactionId: walletTransactionRef,
      paidAt: new Date(),
    });
    if (!marked) {
      // Concurrence : quelqu'un d'autre vient de payer entre-temps. L'argent
      // a déjà été prélevé côté payeur -> incident à tracer, jamais silencieux.
      logger.error({ event: "ShareDoublePaymentRace", shareId: share.id }, "part déjà payée entre la vérification et l'écriture");
      throw new AppError("SHARE_ALREADY_PAID", "Cette participation a déjà été réglée.", 409);
    }

    await this.guaranteeService.releaseForPaidShare(share.bookingId, share.totalAmountCents);
    logger.info({ event: "SplitServiceFeeApplied", shareId: share.id }, "part réglée");

    await this.notificationService
      .enqueue({
        template: "PARTICIPANT_PAYMENT_CONFIRMED",
        recipientUserId: input.payerUserId,
        payload: { shareId: share.id, bookingId: share.bookingId, amountCents: share.totalAmountCents },
      })
      .catch((err) => logger.error({ event: "NotificationEnqueueFailed", shareId: share.id, err }, "échec d'enqueue notification"));

    return this.repo.findById(share.id);
  }

  /** Régularisation (CDC §25, §26) : les parts encore ouvertes à l'échéance sont couvertes par la garantie organisateur. */
  async coverUnpaidSharesWithGuarantee(bookingId: string): Promise<void> {
    const unpaid = await this.repo.findUnpaidByBookingId(bookingId);
    for (const share of unpaid) {
      await this.repo.updateStatus(share.id, "COVERED_BY_ORGANIZER");
    }
  }

  async listForBooking(bookingId: string) {
    return this.repo.findByBookingId(bookingId);
  }

  /** CDC §54 écran 13 — l'organisateur consulte le statut de chaque part de sa réservation SPLIT. */
  async listSharesForOrganizer(bookingId: string, requestingUserId: string) {
    const booking = await this.bookingsRepo.findById(bookingId);
    if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);
    if (booking.organizerUserId !== requestingUserId) {
      throw new AppError(ErrorCodes.FORBIDDEN, "Accès refusé.", 403);
    }
    return this.repo.findByBookingId(bookingId);
  }
}
