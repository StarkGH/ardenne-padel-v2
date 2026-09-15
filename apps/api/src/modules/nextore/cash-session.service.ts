import { AppError, ErrorCodes } from "@ardenne/shared";
import type { NextoreCashSessionRepository } from "./cash-session.repository.js";
import type { AuditLogService } from "../admin/audit-log.service.js";

/**
 * Seuil au-delà duquel un écart de clôture exige une justification
 * (CASH-008). Pas de référentiel de configuration dédié dans ce lot — un
 * seuil raisonnable pour un petit bar, à db exposer en config si le besoin
 * réel diverge à l'usage plutôt que d'anticiper une variable inutilisée.
 */
const VARIANCE_JUSTIFICATION_THRESHOLD_CENTS = 500; // 5 €

export class CashSessionAlreadyOpenError extends AppError {
  constructor() {
    super("NEXTORE_CASH_SESSION_ALREADY_OPEN", "Une session de caisse est déjà ouverte.", 409);
  }
}

/**
 * CDC Nextore §15 (CASH-*) — une session à la fois (un seul terminal
 * physique, confirmé par l'audit Phase 0). Le théorique de clôture n'est
 * jamais un compteur muté : recalculé à la demande depuis le fond déclaré +
 * mouvements + paiements cash réellement enregistrés (CASH-007).
 */
export class NextoreCashSessionService {
  constructor(
    private readonly repo: NextoreCashSessionRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  /** CASH-001/002 — ouverture, comptage déclaré par l'opérateur (CASH-003 : pas de pré-remplissage aveugle imposé ici). */
  async openSession(input: { openedByUserId: string; declaredOpeningCents: number }) {
    if (!Number.isInteger(input.declaredOpeningCents) || input.declaredOpeningCents < 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le fond de caisse déclaré doit être un entier de centimes positif ou nul.", 422);
    }
    const existing = await this.repo.findOpenSession();
    if (existing) throw new CashSessionAlreadyOpenError();

    const session = await this.repo.create({ openedByUserId: input.openedByUserId, declaredOpeningCents: input.declaredOpeningCents });
    await this.auditLog.record({
      actorUserId: input.openedByUserId,
      action: "NEXTORE_CASH_SESSION_OPENED",
      targetType: "NextoreCashSession",
      targetId: session.id,
      after: { declaredOpeningCents: input.declaredOpeningCents },
    });
    return session;
  }

  getCurrentOpenSession() {
    return this.repo.findOpenSession();
  }

  async getSession(id: string) {
    const session = await this.repo.findById(id);
    if (!session) throw new AppError(ErrorCodes.NOT_FOUND, "Session de caisse introuvable.", 404);
    return session;
  }

  /** CASH-005 — mouvement hors vente, motif obligatoire (AUD-005). */
  async recordMovement(input: { sessionId: string; type: "IN" | "OUT"; amountCents: number; reason: string; createdByUserId: string }) {
    if (!input.reason.trim()) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Un motif est obligatoire pour un mouvement de caisse.", 422);
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le montant du mouvement doit être un entier de centimes positif.", 422);
    }
    const session = await this.getSession(input.sessionId);
    if (session.status !== "OPEN") {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Impossible d'ajouter un mouvement à une session clôturée.", 422);
    }
    const movement = await this.repo.addMovement({
      session: { connect: { id: input.sessionId } },
      type: input.type,
      amountCents: input.amountCents,
      reason: input.reason,
      createdByUserId: input.createdByUserId,
    });
    await this.auditLog.record({
      actorUserId: input.createdByUserId,
      action: "NEXTORE_CASH_MOVEMENT_RECORDED",
      targetType: "NextoreCashMovement",
      targetId: movement.id,
      reason: input.reason,
      after: { sessionId: input.sessionId, type: input.type, amountCents: input.amountCents },
    });
    return movement;
  }

  /** CASH-007 — fond déclaré + paiements cash de la session + entrées - sorties. */
  async getTheoreticalCashCents(sessionId: string): Promise<number> {
    const session = await this.getSession(sessionId);
    const [cashPayments, movements] = await Promise.all([
      this.repo.getCashPaymentsTotalCents(sessionId),
      this.repo.listMovements(sessionId),
    ]);
    const movementsNet = movements.reduce((sum, m) => sum + (m.type === "IN" ? m.amountCents : -m.amountCents), 0);
    return session.declaredOpeningCents + cashPayments + movementsNet;
  }

  /**
   * CASH-006/008 — clôture : comptage final obligatoire, écart calculé et
   * enregistré (jamais masqué), justification exigée au-delà du seuil.
   * CASH-009 : une fois `CLOSED`, plus aucune mutation possible (repo ne
   * fournit aucune méthode d'update sur une session déjà fermée).
   */
  async closeSession(input: { sessionId: string; declaredClosingCents: number; justification?: string; closedByUserId: string }) {
    if (!Number.isInteger(input.declaredClosingCents) || input.declaredClosingCents < 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le comptage de clôture doit être un entier de centimes positif ou nul.", 422);
    }
    const session = await this.getSession(input.sessionId);
    if (session.status !== "OPEN") {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Cette session est déjà clôturée.", 422);
    }
    const theoreticalCents = await this.getTheoreticalCashCents(input.sessionId);
    const varianceCents = input.declaredClosingCents - theoreticalCents;

    if (Math.abs(varianceCents) > VARIANCE_JUSTIFICATION_THRESHOLD_CENTS && !input.justification?.trim()) {
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        `Écart de caisse de ${(varianceCents / 100).toFixed(2)} € : une justification est obligatoire au-delà de ${(VARIANCE_JUSTIFICATION_THRESHOLD_CENTS / 100).toFixed(2)} €.`,
        422,
        { varianceCents },
      );
    }

    const closed = await this.repo.close(input.sessionId, {
      closedByUserId: input.closedByUserId,
      closedAt: new Date(),
      declaredClosingCents: input.declaredClosingCents,
      theoreticalClosingCents: theoreticalCents,
      varianceCents,
      varianceJustification: input.justification,
    });
    await this.auditLog.record({
      actorUserId: input.closedByUserId,
      action: "NEXTORE_CASH_SESSION_CLOSED",
      targetType: "NextoreCashSession",
      targetId: input.sessionId,
      reason: input.justification,
      after: { declaredClosingCents: input.declaredClosingCents, theoreticalClosingCents: theoreticalCents, varianceCents },
    });
    return closed;
  }

  /** CASH-010 — rapport de session : ventes/encaissements par moyen, théorique, réel, écarts, annulations, mouvements. */
  async getSessionReport(sessionId: string) {
    const session = await this.getSession(sessionId);
    const [paymentsByMethod, movements, reversalsCount, theoreticalCents] = await Promise.all([
      this.repo.getPaymentsByMethod(sessionId),
      this.repo.listMovements(sessionId),
      this.repo.countReversalsForSession(sessionId),
      session.status === "OPEN" ? this.getTheoreticalCashCents(sessionId) : Promise.resolve(session.theoreticalClosingCents ?? 0),
    ]);
    return {
      session,
      paymentsByMethod,
      movements,
      reversalsCount,
      theoreticalCashCents: theoreticalCents,
    };
  }
}
