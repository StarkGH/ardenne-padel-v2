import { AppError, ErrorCodes, assertCents } from "@ardenne/shared";
import type { NextorePaymentsRepository } from "./payments.repository.js";
import type { NextoreAccountsRepository } from "./accounts.repository.js";
import type { NextoreAccountsService } from "./accounts.service.js";
import type { WalletService } from "../wallet/wallet.service.js";
import type { AuditLogService } from "../admin/audit-log.service.js";

export interface RecordPaymentInput {
  accountId: string;
  participantId?: string;
  amountCents: number;
  method: "CASH" | "CARD" | "WALLET_CREDIT";
  externalReference?: string;
  idempotencyKey: string;
  recordedByUserId: string;
}

/**
 * CDC Nextore §12 — paiements cash/carte/crédits. Idempotence par
 * `idempotencyKey` unique (PAY-012) : un double clic/retry sur la même clé
 * retourne le paiement déjà créé, jamais un second (§60 "Paiement déjà
 * enregistré."). Le crédit wallet réutilise le ledger append-only existant
 * (`WalletService.debitForNextoreAccount`), jamais un second solde.
 */
function isUniqueConstraintError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002");
}

export class NextorePaymentsService {
  constructor(
    private readonly repo: NextorePaymentsRepository,
    private readonly accountsRepo: NextoreAccountsRepository,
    private readonly accountsService: NextoreAccountsService,
    private readonly walletService: WalletService,
    private readonly auditLog: AuditLogService,
  ) {}

  async recordPayment(input: RecordPaymentInput) {
    const existing = await this.repo.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing; // idempotent — jamais un second paiement pour la même clé

    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le montant du paiement doit être un entier de centimes positif.", 422);
    }
    const account = await this.accountsRepo.findById(input.accountId);
    if (!account) throw new AppError(ErrorCodes.NOT_FOUND, "Compte introuvable.", 404);
    if (account.status !== "OPEN" && account.status !== "PARTIALLY_PAID") {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Ce compte n'est plus ouvert.", 422);
    }
    // SPL-006 — trop-perçu : jamais absorbé silencieusement, juste surfacé
    // (`changeCents`) pour que l'opérateur décide (monnaie/pourboire/crédit,
    // hors scope automatisé de ce lot).
    const dueBeforeCents = await this.accountsService.getDueTotalCents(input.accountId);
    const changeCents = Math.max(0, input.amountCents - dueBeforeCents);

    if (input.method !== "WALLET_CREDIT") {
      // CASH/CARD : une seule écriture, déjà atomique (gardée par idempotencyKey unique).
      let payment;
      try {
        payment = await this.repo.createPending({
          account: { connect: { id: input.accountId } },
          participantId: input.participantId,
          amountCents: input.amountCents,
          method: input.method,
          status: "RECORDED",
          externalReference: input.externalReference,
          idempotencyKey: input.idempotencyKey,
          recordedByUserId: input.recordedByUserId,
        });
      } catch (err) {
        // Deux requêtes concurrentes avec la même clé (double clic réel,
        // pas séquentiel) : celle qui perd la course sur la contrainte
        // unique récupère simplement le paiement déjà créé par l'autre.
        if (!isUniqueConstraintError(err)) throw err;
        const raced = await this.repo.findByIdempotencyKey(input.idempotencyKey);
        if (!raced) throw err;
        return raced;
      }
      await this.afterPaymentRecorded(payment.id, input.accountId, input.recordedByUserId, input.method, input.amountCents);
      return { ...payment, changeCents };
    }

    // WALLET_CREDIT — résout le porte-monnaie du participant, sinon celui du client rattaché au compte (PAY-003).
    const customerId = input.participantId
      ? (await this.accountsRepo.findParticipantById(input.participantId))?.customerId
      : account.customerId;
    if (!customerId) {
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "Paiement par crédits impossible : ni le compte ni le participant ne sont rattachés à un client.",
        422,
      );
    }
    const walletAccount = await this.walletService.ensureAccount(customerId);

    // Gate d'idempotence : réserve la ligne PENDING avant tout débit (une
    // seconde requête concurrente avec la même clé échoue sur la contrainte
    // unique et ne débite jamais deux fois).
    let pending;
    try {
      pending = await this.repo.createPending({
        account: { connect: { id: input.accountId } },
        participantId: input.participantId,
        amountCents: input.amountCents,
        method: "WALLET_CREDIT",
        status: "PENDING",
        idempotencyKey: input.idempotencyKey,
        recordedByUserId: input.recordedByUserId,
      });
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      const raced = await this.repo.findByIdempotencyKey(input.idempotencyKey);
      if (!raced) throw err;
      return raced; // l'autre requête concurrente a déjà réservé (et probablement déjà traité) cette clé
    }

    try {
      await this.walletService.debitForNextoreAccount({
        walletAccountId: walletAccount.id,
        nextoreAccountId: input.accountId,
        amountCents: input.amountCents,
      });
    } catch (err) {
      await this.repo.markFailed(pending.id);
      throw err;
    }

    const recorded = await this.repo.markRecorded(pending.id);
    await this.afterPaymentRecorded(recorded.id, input.accountId, input.recordedByUserId, "WALLET_CREDIT", input.amountCents);
    return { ...recorded, changeCents };
  }

  private async afterPaymentRecorded(paymentId: string, accountId: string, actorUserId: string, method: string, amountCents: number) {
    await this.accountsService.markPartiallyPaidIfOpen(accountId);
    await this.auditLog.record({
      actorUserId,
      action: "NEXTORE_PAYMENT_RECORDED",
      targetType: "NextorePayment",
      targetId: paymentId,
      after: { accountId, method, amountCents },
    });
  }

  listForAccount(accountId: string) {
    return this.repo.listForAccount(accountId);
  }

  /**
   * CDC Nextore §26 (COR-002/COR-004) — contrepassation : ne modifie/efface
   * jamais le paiement d'origine, le marque `REVERSED` et restitue les
   * crédits le cas échéant (COR-006).
   */
  async reversePayment(input: { paymentId: string; reason: string; reversedByUserId: string }) {
    if (!input.reason.trim()) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Un motif est obligatoire pour annuler un paiement.", 422);
    }
    const payment = await this.repo.findById(input.paymentId);
    if (!payment) throw new AppError(ErrorCodes.NOT_FOUND, "Paiement introuvable.", 404);
    if (payment.status === "REVERSED") return payment; // idempotent
    if (payment.status !== "RECORDED") {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Seul un paiement enregistré peut être annulé.", 422);
    }

    if (payment.method === "WALLET_CREDIT") {
      const customerId = payment.participantId
        ? (await this.accountsRepo.findParticipantById(payment.participantId))?.customerId
        : (await this.accountsRepo.findById(payment.accountId))?.customerId;
      if (!customerId) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Client introuvable pour restituer les crédits.", 422);
      }
      const walletAccount = await this.walletService.ensureAccount(customerId);
      assertCents(payment.amountCents, "payment.amountCents");
      await this.walletService.refundForNextoreAccount({
        walletAccountId: walletAccount.id,
        nextoreAccountId: payment.accountId,
        amountCents: payment.amountCents,
      });
    }

    const reversed = await this.repo.markReversed(input.paymentId, input.reversedByUserId);
    await this.auditLog.record({
      actorUserId: input.reversedByUserId,
      action: "NEXTORE_PAYMENT_REVERSED",
      targetType: "NextorePayment",
      targetId: payment.id,
      reason: input.reason,
      before: { status: "RECORDED" },
      after: { status: "REVERSED" },
    });
    return reversed;
  }
}
