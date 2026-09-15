import { AppError, ErrorCodes, assertCents } from "@ardenne/shared";
import type { NextoreAccountsRepository } from "./accounts.repository.js";
import type { NextoreCatalogRepository } from "./catalog.repository.js";
import type { NextorePaymentsRepository } from "./payments.repository.js";
import type { AuditLogService } from "../admin/audit-log.service.js";

export class AccountVersionConflictError extends AppError {
  constructor() {
    super(
      "NEXTORE_ACCOUNT_VERSION_CONFLICT",
      "Ce compte a été modifié par un autre opérateur. Rechargez les dernières données.",
      409,
    );
  }
}

export interface OpenAccountInput {
  openedByUserId: string;
  customerId?: string;
  label?: string;
}

export interface AddLineInput {
  accountId: string;
  articleId: string;
  participantId?: string;
  quantity: number;
  operatorUserId: string;
}

/**
 * CDC Nextore §7.3/§10/§11 — moteur transactionnel comptes/participants/
 * lignes. Aucun paiement ici (Lot E) : `getBalance` ne retourne que le
 * total dû, pas de solde payé/restant.
 */
export class NextoreAccountsService {
  constructor(
    private readonly repo: NextoreAccountsRepository,
    private readonly catalogRepo: NextoreCatalogRepository,
    private readonly paymentsRepo: NextorePaymentsRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  /** ACC-001..004 — compte client (customerId) ou éphémère (label libre), jamais les deux vides. */
  async openAccount(input: OpenAccountInput) {
    if (!input.customerId && !input.label?.trim()) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Un compte doit être rattaché à un client ou porter un libellé éphémère.", 422);
    }
    const account = await this.repo.createAccount({
      label: input.label,
      openedByUserId: input.openedByUserId,
      ...(input.customerId ? { customer: { connect: { id: input.customerId } } } : {}),
    });
    await this.auditLog.record({
      actorUserId: input.openedByUserId,
      action: "NEXTORE_ACCOUNT_OPENED",
      targetType: "NextoreAccount",
      targetId: account.id,
      after: { customerId: input.customerId ?? null, label: input.label ?? null },
    });
    return account;
  }

  listOpenAccounts() {
    return this.repo.listOpen();
  }

  async getAccount(id: string) {
    const account = await this.repo.findById(id);
    if (!account) throw new AppError(ErrorCodes.NOT_FOUND, "Compte introuvable.", 404);
    return account;
  }

  /** ACC-007 — total des lignes actives, avant tout paiement (quantity peut être fractionnaire). */
  async getSalesTotalCents(accountId: string): Promise<number> {
    const lines = await this.repo.listActiveLines(accountId);
    return lines.reduce((sum, line) => sum + Math.round(Number(line.quantity) * line.unitPriceCentsAtSale), 0);
  }

  /**
   * ACC-007/ACC-008 — solde restant dû = ventes actives - paiements
   * enregistrés (RECORDED). Peut être négatif (trop-perçu, ACC-009/SPL-006) —
   * volontairement non clampé à zéro : le restituer explicitement plutôt que
   * de le masquer est la décision retenue pour ce lot (pas encore de
   * workflow monnaie/pourboire/crédit — Lot F).
   */
  async getDueTotalCents(accountId: string): Promise<number> {
    const [sales, paid] = await Promise.all([this.getSalesTotalCents(accountId), this.paymentsRepo.getRecordedTotalCents(accountId)]);
    return sales - paid;
  }

  /**
   * Lot Nextore E — première transition OPEN -> PARTIALLY_PAID dès qu'un
   * paiement (même partiel) est enregistré. Idempotent : n'agit que si le
   * compte est encore OPEN, ignore silencieusement sinon (déjà
   * PARTIALLY_PAID ou CLOSED — appelé après chaque paiement).
   */
  async markPartiallyPaidIfOpen(accountId: string): Promise<void> {
    const account = await this.getAccount(accountId);
    if (account.status !== "OPEN") return;
    await this.repo.updateWithVersionCheck(accountId, account.version, { status: "PARTIALLY_PAID" });
  }

  /** GRP-001/002 — participant identifié (customerId) ou local (displayName). */
  async addParticipant(input: { accountId: string; customerId?: string; displayName?: string }) {
    if (!input.customerId && !input.displayName?.trim()) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Un participant doit être un client existant ou avoir un nom local.", 422);
    }
    await this.getAccount(input.accountId);
    return this.repo.addParticipant({
      account: { connect: { id: input.accountId } },
      displayName: input.displayName,
      ...(input.customerId ? { customer: { connect: { id: input.customerId } } } : {}),
    });
  }

  /** GRP-003 — fige la situation du participant au moment de son départ. */
  async removeParticipant(participantId: string) {
    const participant = await this.repo.findParticipantById(participantId);
    if (!participant) throw new AppError(ErrorCodes.NOT_FOUND, "Participant introuvable.", 404);
    if (participant.leftAt) return participant; // déjà parti — idempotent
    return this.repo.setParticipantLeft(participantId, new Date());
  }

  /**
   * POS-004/005 — ajoute une ligne au compte actif. Snapshot prix/TVA au
   * moment de la vente (CAT-004) : ne relit jamais `NextoreArticle` après
   * coup. GRP-007 : un participant dont `leftAt` est déjà renseigné ne peut
   * plus recevoir de nouvelle ligne (CT-04 du CDC).
   */
  async addLine(input: AddLineInput) {
    if (input.quantity <= 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "La quantité doit être positive.", 422);
    }
    const account = await this.getAccount(input.accountId);
    if (account.status !== "OPEN" && account.status !== "PARTIALLY_PAID") {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Ce compte n'est plus ouvert.", 422);
    }
    const article = await this.catalogRepo.findArticleById(input.articleId);
    if (!article || !article.active) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Article introuvable ou inactif.", 404);
    }
    if (input.participantId) {
      const participant = await this.repo.findParticipantById(input.participantId);
      if (!participant || participant.accountId !== input.accountId) {
        throw new AppError(ErrorCodes.NOT_FOUND, "Participant introuvable sur ce compte.", 404);
      }
      if (participant.leftAt) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Ce participant a quitté le compte : impossible de lui affecter une nouvelle ligne.", 422);
      }
    }

    const line = await this.repo.addLine({
      account: { connect: { id: input.accountId } },
      article: { connect: { id: input.articleId } },
      ...(input.participantId ? { participant: { connect: { id: input.participantId } } } : {}),
      quantity: input.quantity,
      unitPriceCentsAtSale: article.priceCents,
      vatRateAtSalePercent: article.vatRatePercent,
      operatorUserId: input.operatorUserId,
    });
    await this.auditLog.record({
      actorUserId: input.operatorUserId,
      action: "NEXTORE_LINE_ADDED",
      targetType: "NextoreSaleLine",
      targetId: line.id,
      after: { accountId: input.accountId, articleId: input.articleId, quantity: input.quantity },
    });
    return line;
  }

  /** POS-007/COR-001 — jamais de suppression physique, toujours une annulation motivée. */
  async voidLine(input: { lineId: string; reason: string; voidedByUserId: string }) {
    if (!input.reason.trim()) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Un motif est obligatoire pour annuler une ligne.", 422);
    }
    const line = await this.repo.findLineById(input.lineId);
    if (!line) throw new AppError(ErrorCodes.NOT_FOUND, "Ligne introuvable.", 404);
    if (line.status === "VOIDED") return line; // idempotent

    const voided = await this.repo.voidLine(input.lineId, {
      voidReason: input.reason,
      voidedByUserId: input.voidedByUserId,
      voidedAt: new Date(),
    });
    await this.auditLog.record({
      actorUserId: input.voidedByUserId,
      action: "NEXTORE_LINE_VOIDED",
      targetType: "NextoreSaleLine",
      targetId: line.id,
      reason: input.reason,
      before: { status: line.status },
      after: { status: "VOIDED" },
    });
    return voided;
  }

  /**
   * ACC-008/§30.3 — clôture d'un compte soldé (pas de paiement dans ce lot :
   * un compte sans lignes actives dues, ou explicitement forcé par un
   * manager, cf `force`). Verrouillage optimiste : `expectedVersion` doit
   * correspondre à l'état lu par l'appelant, sinon `AccountVersionConflictError`.
   */
  async closeAccount(input: { accountId: string; expectedVersion: number; closedByUserId: string; force?: boolean }) {
    const account = await this.getAccount(input.accountId);
    if (!input.force) {
      const due = await this.getDueTotalCents(input.accountId);
      assertCents(due, "dueTotalCents");
      if (due !== 0) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, `Impossible de clôturer : ${(due / 100).toFixed(2)} € restent dus.`, 422, { dueCents: due });
      }
    }
    const applied = await this.repo.updateWithVersionCheck(input.accountId, input.expectedVersion, {
      status: "CLOSED",
      closedAt: new Date(),
    });
    if (!applied) throw new AccountVersionConflictError();

    await this.auditLog.record({
      actorUserId: input.closedByUserId,
      action: "NEXTORE_ACCOUNT_CLOSED",
      targetType: "NextoreAccount",
      targetId: input.accountId,
      before: { status: account.status },
      after: { status: "CLOSED" },
    });
  }
}
