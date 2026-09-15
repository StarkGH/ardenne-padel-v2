import { AppError, ErrorCodes, splitEvenly } from "@ardenne/shared";
import type { NextoreAccountsRepository } from "./accounts.repository.js";
import type { NextoreAccountsService } from "./accounts.service.js";
import type { NextorePaymentsRepository } from "./payments.repository.js";

export interface EqualSplitShare {
  index: number;
  amountCents: number;
}

export interface ParticipantSummary {
  participantId: string | null; // null = consommations/paiements non affectés à un participant précis
  customerId: string | null;
  displayName: string | null;
  leftAt: Date | null;
  consumptionCents: number;
  paidCents: number;
  balanceCents: number; // consumptionCents - paidCents ; négatif = trop-perçu (SPL-006)
  status: "SETTLED" | "PARTIAL" | "OPEN";
}

/**
 * CDC Nextore §13 (split) — pas de nouvelle table d'allocation : un split
 * égal ou libre est simplement une série de `NextorePayment` taguée par
 * `participantId`, réutilisant Lot E tel quel (SPL-003/004). Cette classe
 * ne fait que calculer les parts (SPL-001/002, via `splitEvenly` déjà
 * validé pour les réservations) et la synthèse par participant (SPL-008).
 */
export class NextoreSplitService {
  constructor(
    private readonly accountsRepo: NextoreAccountsRepository,
    private readonly accountsService: NextoreAccountsService,
    private readonly paymentsRepo: NextorePaymentsRepository,
  ) {}

  /** SPL-001/002 — divise le solde restant dû en `parts` parts égales, centimes résiduels sur les premières parts. */
  async previewEqualSplit(accountId: string, parts: number): Promise<EqualSplitShare[]> {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le nombre de parts doit être un entier positif.", 422);
    }
    const dueCents = await this.accountsService.getDueTotalCents(accountId);
    if (dueCents <= 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Ce compte n'a pas de solde positif à diviser.", 422, { dueCents });
    }
    return splitEvenly(dueCents, parts).map((amountCents, index) => ({ index, amountCents }));
  }

  /** SPL-008 — consommation, paiements et solde par participant (+ un bucket "non affecté"). */
  async getParticipantsSummary(accountId: string): Promise<ParticipantSummary[]> {
    const [participants, lines, payments] = await Promise.all([
      this.accountsRepo.listParticipants(accountId),
      this.accountsRepo.listActiveLines(accountId),
      this.paymentsRepo.listForAccount(accountId),
    ]);

    const consumptionByParticipant = new Map<string | null, number>();
    for (const line of lines) {
      const key = line.participantId ?? null;
      const amount = Math.round(Number(line.quantity) * line.unitPriceCentsAtSale);
      consumptionByParticipant.set(key, (consumptionByParticipant.get(key) ?? 0) + amount);
    }

    const paidByParticipant = new Map<string | null, number>();
    for (const payment of payments) {
      if (payment.status !== "RECORDED") continue; // PENDING/FAILED/REVERSED ne comptent jamais dans le solde
      const key = payment.participantId ?? null;
      paidByParticipant.set(key, (paidByParticipant.get(key) ?? 0) + payment.amountCents);
    }

    const keys = new Set<string | null>([null, ...participants.map((p) => p.id)]);
    const summaries: ParticipantSummary[] = [];
    for (const key of keys) {
      const consumptionCents = consumptionByParticipant.get(key) ?? 0;
      const paidCents = paidByParticipant.get(key) ?? 0;
      if (key === null && consumptionCents === 0 && paidCents === 0) continue; // pas de bucket "non affecté" vide
      const balanceCents = consumptionCents - paidCents;
      const participant = key ? participants.find((p) => p.id === key) : undefined;
      summaries.push({
        participantId: key,
        customerId: participant?.customerId ?? null,
        displayName: participant?.displayName ?? null,
        leftAt: participant?.leftAt ?? null,
        consumptionCents,
        paidCents,
        balanceCents,
        status: balanceCents <= 0 ? "SETTLED" : paidCents > 0 ? "PARTIAL" : "OPEN",
      });
    }
    return summaries;
  }
}
