import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "@ardenne/shared";
import type { NextoreReconciliationRepository } from "./reconciliation.repository.js";
import type { AuditLogService } from "../admin/audit-log.service.js";

/** REC0-002 — fenêtre autour de la date bancaire (règlement carte non instantané, pas une tolérance de montant). */
const MATCH_WINDOW_DAYS = 3;

export interface ImportRow {
  externalDate: Date;
  externalAmountCents: number;
  externalReference?: string;
}

/**
 * CDC Nextore §23 (REC0-*) — rapprochement Europabank/Loyaltek. Montant
 * EXACT obligatoire (REC0-007), jamais de tolérance silencieuse. Le statut
 * de chaque ligne (MATCHED/UNMATCHED/AMBIGUOUS) est toujours explicite et
 * traçable (REC0-006) ; une confirmation manuelle reste possible pour les
 * cas ambigus (REC0-005), jamais un rapprochement automatique forcé.
 */
export class NextoreReconciliationService {
  constructor(
    private readonly repo: NextoreReconciliationRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  /** REC0-001 — import d'un relevé (déjà parsé en lignes structurées ; le parsing CSV/Excel lui-même est hors service). */
  async importBatch(input: { rows: ImportRow[]; importedByUserId: string; sourceFilename?: string }) {
    if (input.rows.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "L'import ne contient aucune ligne.", 422);
    }
    for (const row of input.rows) {
      if (!Number.isInteger(row.externalAmountCents) || row.externalAmountCents <= 0) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Chaque ligne doit avoir un montant en centimes positif.", 422);
      }
    }

    const batch = await this.repo.createImport({
      importedByUserId: input.importedByUserId,
      sourceFilename: input.sourceFilename,
      totalRows: input.rows.length,
    });
    await this.repo.createEntries(
      input.rows.map((row) => ({
        id: randomUUID(),
        importId: batch.id,
        externalDate: row.externalDate,
        externalAmountCents: row.externalAmountCents,
        externalReference: row.externalReference,
      })),
    );
    await this.auditLog.record({
      actorUserId: input.importedByUserId,
      action: "NEXTORE_RECONCILIATION_IMPORTED",
      targetType: "NextoreReconciliationImport",
      targetId: batch.id,
      after: { totalRows: input.rows.length, sourceFilename: input.sourceFilename },
    });

    // REC0-002/003 — tentative de rapprochement automatique, ligne par ligne.
    const entries = await this.repo.listEntriesForImport(batch.id);
    for (const entry of entries) {
      await this.autoMatchEntry(entry.id);
    }
    return this.repo.listEntriesForImport(batch.id);
  }

  private async autoMatchEntry(entryId: string) {
    const entry = await this.repo.findEntryById(entryId);
    if (!entry) return;

    const from = new Date(entry.externalDate);
    from.setDate(from.getDate() - MATCH_WINDOW_DAYS);
    const to = new Date(entry.externalDate);
    to.setDate(to.getDate() + MATCH_WINDOW_DAYS);

    const candidates = await this.repo.findCandidatePayments(entry.externalAmountCents, from, to);

    if (candidates.length === 1) {
      await this.repo.updateEntry(entryId, { status: "MATCHED", matchedPaymentId: candidates[0]!.id, matchedAt: new Date() });
    } else if (candidates.length > 1) {
      await this.repo.updateEntry(entryId, { status: "AMBIGUOUS" });
    } else {
      await this.repo.updateEntry(entryId, { status: "UNMATCHED" });
    }
  }

  /** REC0-004 — vue d'exception prioritaire (jamais une comparaison manuelle exhaustive). */
  listExceptions() {
    return this.repo.listExceptions();
  }

  /** REC0-005 — confirmation/correction manuelle, avec commentaire, toujours auditée. */
  async confirmMatch(input: { entryId: string; paymentId: string; confirmedByUserId: string; note?: string }) {
    const entry = await this.repo.findEntryById(input.entryId);
    if (!entry) throw new AppError(ErrorCodes.NOT_FOUND, "Ligne de rapprochement introuvable.", 404);

    const updated = await this.repo.updateEntry(input.entryId, {
      status: "MATCHED",
      matchedPaymentId: input.paymentId,
      matchedByUserId: input.confirmedByUserId,
      matchedAt: new Date(),
      note: input.note,
    });
    await this.auditLog.record({
      actorUserId: input.confirmedByUserId,
      action: "NEXTORE_RECONCILIATION_CONFIRMED",
      targetType: "NextoreReconciliationEntry",
      targetId: input.entryId,
      reason: input.note,
      before: { status: entry.status },
      after: { status: "MATCHED", matchedPaymentId: input.paymentId },
    });
    return updated;
  }

  /** Signal proactif : paiements carte non rapprochés au-delà du délai normal de règlement (pas d'attente passive d'un import). */
  listUnreconciledCardPayments(olderThanDays = MATCH_WINDOW_DAYS + 4) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    return this.repo.listUnreconciledCardPayments(cutoff);
  }
}
