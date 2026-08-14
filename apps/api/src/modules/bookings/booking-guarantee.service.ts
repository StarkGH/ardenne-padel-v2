import { AppError } from "@ardenne/shared";
import type { WalletService } from "../wallet/wallet.service.js";
import type { PaymentProvider } from "../payments/types.js";
import type { BookingGuaranteeRepository } from "./booking-guarantee.repository.js";

export interface CreateWalletGuaranteeInput {
  bookingId: string;
  organizerUserId: string;
  walletAccountId: string;
  amountCents: number;
}

export interface CreateCardGuaranteeInput {
  bookingId: string;
  organizerUserId: string;
  amountCents: number;
  /** Moyen déjà consenti pour un débit futur (obtenu via `POST /payments/setup`, CDC §25.1). */
  paymentMethodId: string;
}

/**
 * CDC §25 — garantie de l'organisateur pour le SPLIT. Un seul mécanisme actif
 * par réservation (§25.3) : le type est fixé à la création, jamais combiné.
 */
export class BookingGuaranteeService {
  constructor(
    private readonly repo: BookingGuaranteeRepository,
    private readonly walletService: WalletService,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async createWalletGuarantee(input: CreateWalletGuaranteeInput) {
    const hold = await this.walletService.createHold({
      walletAccountId: input.walletAccountId,
      bookingId: input.bookingId,
      amountCents: input.amountCents,
    });
    return this.repo.create({
      booking: { connect: { id: input.bookingId } },
      type: "WALLET_RESERVE",
      organizerUserId: input.organizerUserId,
      guaranteedAmountCents: input.amountCents,
      remainingGuaranteedCents: input.amountCents,
      walletHoldId: hold.id,
    });
  }

  async createCardGuarantee(input: CreateCardGuaranteeInput) {
    return this.repo.create({
      booking: { connect: { id: input.bookingId } },
      type: "CARD_OFF_SESSION",
      organizerUserId: input.organizerUserId,
      guaranteedAmountCents: input.amountCents,
      remainingGuaranteedCents: input.amountCents,
      paymentMethodId: input.paymentMethodId,
    });
  }

  /** Annulation avant confirmation (collision Legacy) — libère sans jamais avoir consommé. */
  async releaseEntirely(bookingId: string): Promise<void> {
    const guarantee = await this.repo.findByBookingId(bookingId);
    if (!guarantee || guarantee.status === "RELEASED" || guarantee.status === "CONSUMED") return;

    if (guarantee.type === "WALLET_RESERVE" && guarantee.walletHoldId) {
      await this.walletService.releaseHold(guarantee.walletHoldId);
    }
    await this.repo.markStatus(bookingId, "RELEASED", { releasedAt: new Date(), remainingGuaranteedCents: 0 });
  }

  /** Une part payée réduit d'autant la garantie restante (CDC §26 : "la garantie organisateur est diminuée/libérée à concurrence de cette part"). */
  async releaseForPaidShare(bookingId: string, amountCents: number): Promise<void> {
    const guarantee = await this.repo.findByBookingId(bookingId);
    if (!guarantee || guarantee.status === "RELEASED" || guarantee.status === "CONSUMED") return;

    const released = await this.repo.releaseAmount(bookingId, amountCents);
    if (!released) return; // déjà entièrement traitée — idempotent, pas d'erreur

    const updated = await this.repo.findByBookingId(bookingId);
    if (!updated) return;

    // Le hold wallet sous-jacent doit refléter la même réduction que la
    // garantie, sinon `balance_reserved` resterait faux (CDC §111).
    if (updated.type === "WALLET_RESERVE" && updated.walletHoldId) {
      await this.walletService.releaseHoldPartially(updated.walletHoldId, amountCents);
    }

    if (updated.remainingGuaranteedCents === 0) {
      await this.repo.markStatus(bookingId, "RELEASED", { releasedAt: new Date() });
    } else {
      await this.repo.markStatus(bookingId, "PARTIALLY_RELEASED");
    }
  }

  /**
   * Régularisation (CDC §25.1-§25.2) : capture ce qu'il reste de la garantie
   * à l'échéance des parts impayées. `customerId` requis seulement pour
   * `CARD_OFF_SESSION` (débit off-session via le moyen enregistré).
   */
  async captureRemaining(bookingId: string, customerId?: string): Promise<{ capturedCents: number }> {
    const guarantee = await this.repo.findByBookingId(bookingId);
    if (!guarantee || guarantee.status === "RELEASED" || guarantee.status === "CONSUMED" || guarantee.remainingGuaranteedCents === 0) {
      return { capturedCents: 0 };
    }

    if (guarantee.type === "WALLET_RESERVE" && guarantee.walletHoldId) {
      await this.walletService.captureHold(guarantee.walletHoldId);
    } else if (guarantee.type === "CARD_OFF_SESSION" && guarantee.paymentMethodId) {
      if (!customerId) throw new AppError("VALIDATION_FAILED", "customerId requis pour une régularisation carte.", 500);

      const authorized = await this.paymentProvider.chargeSavedMethod({
        customerId,
        paymentMethodId: guarantee.paymentMethodId,
        amountCents: guarantee.remainingGuaranteedCents,
        currency: "EUR",
        idempotencyKey: `guarantee-capture:${bookingId}`,
      });

      if (authorized.status === "requires_capture") {
        const captured = await this.paymentProvider.confirmOrCapture({ providerPaymentId: authorized.providerPaymentId });
        if (captured.status !== "succeeded") {
          await this.repo.markStatus(bookingId, "FAILED");
          throw new AppError("GUARANTEE_CAPTURE_FAILED", "La régularisation par carte a échoué.", 402);
        }
      } else if (authorized.status !== "succeeded") {
        await this.repo.markStatus(bookingId, "FAILED");
        throw new AppError("GUARANTEE_CAPTURE_FAILED", "La régularisation par carte a échoué.", 402);
      }
    }

    const capturedCents = guarantee.remainingGuaranteedCents;
    await this.repo.markStatus(bookingId, "CONSUMED", { remainingGuaranteedCents: 0 });
    return { capturedCents };
  }
}
