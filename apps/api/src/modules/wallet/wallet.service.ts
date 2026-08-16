import { randomUUID } from "node:crypto";
import { AppError, assertCents, logger } from "@ardenne/shared";
import type { WalletCreditOrigin } from "@prisma/client";
import type { WalletRepository } from "./wallet.repository.js";

export class InsufficientWalletBalanceError extends AppError {
  constructor(availableCents: number, requestedCents: number) {
    super("INSUFFICIENT_WALLET_BALANCE", "Solde de crédits insuffisant.", 409, { availableCents, requestedCents });
  }
}

export interface WalletBalance {
  totalCents: number;
  reservedCents: number;
  availableCents: number;
  byOrigin: Record<WalletCreditOrigin, number>;
}

/**
 * Consommation à l'usage : le bonus est dépensé en premier (CDC §28.5 —
 * politique d'expiration possible sur le bonus, jamais sur le payé) afin de
 * limiter le gaspillage de crédits susceptibles d'expirer. Décision produit
 * documentée ici plutôt que dans le CDC, qui ne fixe pas d'ordre explicite.
 */
const DEBIT_ORIGIN_ORDER: WalletCreditOrigin[] = ["BONUS", "PAID", "ADMIN_COMP"];

/**
 * CDC §28 — wallet fermé, ledger append-only. Aucune méthode ici ne fait
 * jamais `balance += x` : tout passe par une transaction ajoutée au ledger
 * (CDC §111, anti-pattern explicitement interdit).
 */
export class WalletService {
  constructor(private readonly repo: WalletRepository) {}

  async ensureAccount(userId: string) {
    return this.repo.ensureAccount(userId);
  }

  async getBalance(walletAccountId: string): Promise<WalletBalance> {
    const [totalCents, reservedCents, byOrigin] = await Promise.all([
      this.repo.getBalanceTotalCents(walletAccountId),
      this.repo.getReservedCents(walletAccountId),
      this.repo.getBalanceByOrigin(walletAccountId),
    ]);
    return { totalCents, reservedCents, availableCents: totalCents - reservedCents, byOrigin };
  }

  /** CDC §28.2 — crédite un pack acheté (payé + bonus séparément, jamais fusionnés). */
  async creditFromPackPurchase(input: {
    walletAccountId: string;
    creditPackPurchaseId: string;
    paidCreditsCents: number;
    bonusCreditsCents: number;
  }): Promise<void> {
    assertCents(input.paidCreditsCents, "paidCreditsCents");
    assertCents(input.bonusCreditsCents, "bonusCreditsCents");

    if (input.paidCreditsCents > 0) {
      await this.repo.createTransaction({
        walletAccount: { connect: { id: input.walletAccountId } },
        type: "CREDIT_PACK_PURCHASE",
        amountCents: input.paidCreditsCents,
        creditOrigin: "PAID",
        creditPackPurchaseId: input.creditPackPurchaseId,
      });
    }
    if (input.bonusCreditsCents > 0) {
      await this.repo.createTransaction({
        walletAccount: { connect: { id: input.walletAccountId } },
        type: "CREDIT_PACK_BONUS",
        amountCents: input.bonusCreditsCents,
        creditOrigin: "BONUS",
        creditPackPurchaseId: input.creditPackPurchaseId,
      });
    }
    logger.info(
      { event: "WalletCredited", walletAccountId: input.walletAccountId, creditPackPurchaseId: input.creditPackPurchaseId },
      "wallet crédité (achat de pack)",
    );
  }

  async creditAdmin(input: { walletAccountId: string; amountCents: number; createdBy: string; reason: string }): Promise<void> {
    assertCents(input.amountCents, "amountCents");
    if (input.amountCents <= 0) {
      throw new AppError("VALIDATION_FAILED", "Le montant crédité doit être positif.", 422);
    }
    await this.repo.createTransaction({
      walletAccount: { connect: { id: input.walletAccountId } },
      type: "CREDIT_ADMIN",
      amountCents: input.amountCents,
      creditOrigin: "ADMIN_COMP",
      createdBy: input.createdBy,
      reference: input.reason,
    });
  }

  /** CDC §55 écran 11 — débit manuel avec motif (erreur de crédit, régularisation), jamais lié à une réservation. */
  async debitAdmin(input: { walletAccountId: string; amountCents: number; createdBy: string; reason: string }): Promise<void> {
    assertCents(input.amountCents, "amountCents");
    if (input.amountCents <= 0) {
      throw new AppError("VALIDATION_FAILED", "Le montant débité doit être positif.", 422);
    }
    const balance = await this.getBalance(input.walletAccountId);
    if (balance.availableCents < input.amountCents) {
      throw new InsufficientWalletBalanceError(balance.availableCents, input.amountCents);
    }
    const breakdown = this.allocateAcrossOrigins(input.amountCents, balance.byOrigin);
    const rows = breakdown
      .filter((b) => b.amountCents > 0)
      .map((b) => ({
        id: randomUUID(),
        walletAccountId: input.walletAccountId,
        type: "ADJUSTMENT" as const,
        amountCents: -b.amountCents,
        creditOrigin: b.origin,
        createdBy: input.createdBy,
        reference: input.reason,
      }));
    await this.repo.createTransactions(rows);
  }

  /**
   * Débit direct (sans hold), pour un paiement 100% wallet immédiat.
   * Répartit sur les origines disponibles (bonus d'abord) et échoue
   * entièrement (aucune écriture) si le solde disponible est insuffisant.
   */
  async debitForBooking(input: { walletAccountId: string; bookingId: string; amountCents: number }): Promise<void> {
    assertCents(input.amountCents, "amountCents");
    const balance = await this.getBalance(input.walletAccountId);
    if (balance.availableCents < input.amountCents) {
      throw new InsufficientWalletBalanceError(balance.availableCents, input.amountCents);
    }

    const breakdown = this.allocateAcrossOrigins(input.amountCents, balance.byOrigin);
    const rows = breakdown
      .filter((b) => b.amountCents > 0)
      .map((b) => ({
        id: randomUUID(),
        walletAccountId: input.walletAccountId,
        type: "DEBIT_BOOKING" as const,
        amountCents: -b.amountCents,
        creditOrigin: b.origin,
        bookingId: input.bookingId,
      }));
    await this.repo.createTransactions(rows);
    logger.info({ event: "WalletDebited", walletAccountId: input.walletAccountId, bookingId: input.bookingId, amountCents: input.amountCents }, "wallet débité");
  }

  /** CDC §25.2, §27.3 — réserve des crédits comme garantie sans les dépenser. */
  async createHold(input: { walletAccountId: string; bookingId: string; amountCents: number }) {
    assertCents(input.amountCents, "amountCents");
    const balance = await this.getBalance(input.walletAccountId);
    if (balance.availableCents < input.amountCents) {
      throw new InsufficientWalletBalanceError(balance.availableCents, input.amountCents);
    }

    const hold = await this.repo.createHold({
      walletAccount: { connect: { id: input.walletAccountId } },
      bookingId: input.bookingId,
      amountCents: input.amountCents,
    });
    await this.repo.createTransaction({
      walletAccount: { connect: { id: input.walletAccountId } },
      type: "HOLD_CREATED",
      amountCents: input.amountCents,
      bookingId: input.bookingId,
      walletHoldId: hold.id,
    });
    return hold;
  }

  /** Libère un hold sans dépenser les crédits (collision, échec, annulation). */
  async releaseHold(holdId: string): Promise<void> {
    const hold = await this.repo.findHoldById(holdId);
    if (!hold) throw new AppError("NOT_FOUND", "Garantie wallet introuvable.", 404);

    const transitioned = await this.repo.transitionHold(holdId, "ACTIVE", { status: "RELEASED", releasedAt: new Date() });
    if (!transitioned) return; // déjà capturé/libéré — idempotent, pas d'erreur (CDC §47.2.bis)

    await this.repo.createTransaction({
      walletAccount: { connect: { id: hold.walletAccountId } },
      type: "HOLD_RELEASED",
      amountCents: hold.amountCents,
      bookingId: hold.bookingId,
      walletHoldId: hold.id,
    });
  }

  /**
   * Libère une partie seulement d'un hold (CDC §26 : une part payée réduit
   * la garantie sans la lever entièrement). Si le montant réduit épuise le
   * hold, il passe `RELEASED` — sinon il reste `ACTIVE` avec un montant
   * réduit. Idempotent par construction : appeler deux fois avec le même
   * montant échouerait proprement la seconde fois (montant insuffisant),
   * jamais une double libération silencieuse.
   */
  async releaseHoldPartially(holdId: string, amountCents: number): Promise<void> {
    assertCents(amountCents, "amountCents");
    const hold = await this.repo.findHoldById(holdId);
    if (!hold) throw new AppError("NOT_FOUND", "Garantie wallet introuvable.", 404);
    if (hold.status !== "ACTIVE") return; // déjà traité — idempotent

    if (amountCents >= hold.amountCents) {
      await this.releaseHold(holdId);
      return;
    }

    const reduced = await this.repo.reduceHoldAmount(holdId, amountCents);
    if (!reduced) return;

    await this.repo.createTransaction({
      walletAccount: { connect: { id: hold.walletAccountId } },
      type: "HOLD_RELEASED",
      amountCents,
      bookingId: hold.bookingId,
      walletHoldId: hold.id,
    });
  }

  /** Convertit un hold en débit réel — seul moment où les crédits sont réellement dépensés. */
  async captureHold(holdId: string): Promise<void> {
    const hold = await this.repo.findHoldById(holdId);
    if (!hold) throw new AppError("NOT_FOUND", "Garantie wallet introuvable.", 404);

    const transitioned = await this.repo.transitionHold(holdId, "ACTIVE", { status: "CAPTURED", capturedAt: new Date() });
    if (!transitioned) return; // déjà traité — idempotent (CDC §47.2.bis)

    const balance = await this.getBalance(hold.walletAccountId);
    // Le hold garantissait déjà la disponibilité ; on répartit sur le solde
    // total (hors réservation, puisque ce hold vient d'être levé) au moment
    // de la capture — cohérent même si d'autres mouvements sont survenus.
    const breakdown = this.allocateAcrossOrigins(hold.amountCents, balance.byOrigin);

    await this.repo.createTransactions(
      breakdown
        .filter((b) => b.amountCents > 0)
        .map((b) => ({
          id: randomUUID(),
          walletAccountId: hold.walletAccountId,
          type: "DEBIT_BOOKING" as const,
          amountCents: -b.amountCents,
          creditOrigin: b.origin,
          bookingId: hold.bookingId,
          walletHoldId: hold.id,
        })),
    );
    await this.repo.createTransaction({
      walletAccount: { connect: { id: hold.walletAccountId } },
      type: "HOLD_CAPTURED",
      amountCents: hold.amountCents,
      bookingId: hold.bookingId,
      walletHoldId: hold.id,
    });
  }

  /**
   * CDC §28.10 — restitue la composition d'origine plutôt qu'un montant
   * global. Un remboursement partiel restitue chaque origine au prorata de
   * ce qui avait été consommé pour cette réservation.
   */
  async refundForBooking(input: { walletAccountId: string; bookingId: string; amountCents: number }): Promise<void> {
    assertCents(input.amountCents, "amountCents");
    const [debited, alreadyRefunded] = await Promise.all([
      this.repo.getDebitBreakdownForBooking(input.bookingId),
      this.repo.getRefundedBreakdownForBooking(input.bookingId),
    ]);

    const refundable: Record<WalletCreditOrigin, number> = {
      PAID: debited.PAID - alreadyRefunded.PAID,
      BONUS: debited.BONUS - alreadyRefunded.BONUS,
      ADMIN_COMP: debited.ADMIN_COMP - alreadyRefunded.ADMIN_COMP,
    };
    const totalRefundable = refundable.PAID + refundable.BONUS + refundable.ADMIN_COMP;
    if (input.amountCents > totalRefundable) {
      throw new AppError("VALIDATION_FAILED", "Le montant à rembourser dépasse ce qui a été débité sur ce wallet pour cette réservation.", 422, {
        totalRefundable,
        requested: input.amountCents,
      });
    }

    const breakdown = this.allocateProportionally(input.amountCents, refundable);
    await this.repo.createTransactions(
      breakdown
        .filter((b) => b.amountCents > 0)
        .map((b) => ({
          id: randomUUID(),
          walletAccountId: input.walletAccountId,
          type: "REFUND_BOOKING" as const,
          amountCents: b.amountCents,
          creditOrigin: b.origin,
          bookingId: input.bookingId,
        })),
    );
    logger.info({ event: "WalletRefunded", walletAccountId: input.walletAccountId, bookingId: input.bookingId, amountCents: input.amountCents }, "wallet remboursé");
  }

  /** Répartit `amountCents` sur les origines dans l'ordre `DEBIT_ORIGIN_ORDER`, sans dépasser le disponible de chacune. */
  private allocateAcrossOrigins(
    amountCents: number,
    available: Record<WalletCreditOrigin, number>,
  ): Array<{ origin: WalletCreditOrigin; amountCents: number }> {
    let remaining = amountCents;
    const result: Array<{ origin: WalletCreditOrigin; amountCents: number }> = [];
    for (const origin of DEBIT_ORIGIN_ORDER) {
      if (remaining <= 0) break;
      const take = Math.min(available[origin], remaining);
      if (take > 0) {
        result.push({ origin, amountCents: take });
        remaining -= take;
      }
    }
    if (remaining > 0) {
      throw new Error("allocateAcrossOrigins: solde insuffisant malgré la vérification préalable (incohérence interne)");
    }
    return result;
  }

  /** Répartit un remboursement au prorata de ce qui a été consommé par origine (CDC §28.10), centimes résiduels sur la première origine non nulle. */
  private allocateProportionally(
    amountCents: number,
    refundable: Record<WalletCreditOrigin, number>,
  ): Array<{ origin: WalletCreditOrigin; amountCents: number }> {
    const total = refundable.PAID + refundable.BONUS + refundable.ADMIN_COMP;
    if (total === 0) return [];
    if (amountCents === total) {
      return DEBIT_ORIGIN_ORDER.map((origin) => ({ origin, amountCents: refundable[origin] }));
    }

    const raw = DEBIT_ORIGIN_ORDER.map((origin) => ({
      origin,
      amountCents: Math.floor((refundable[origin] * amountCents) / total),
    }));
    const allocated = raw.reduce((sum, r) => sum + r.amountCents, 0);
    let residual = amountCents - allocated;
    for (const r of raw) {
      if (residual <= 0) break;
      const room = refundable[r.origin] - r.amountCents;
      const add = Math.min(room, residual);
      r.amountCents += add;
      residual -= add;
    }
    return raw;
  }
}
