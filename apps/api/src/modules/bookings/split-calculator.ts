import { splitEvenly } from "@ardenne/shared";

/**
 * CDC §23.3, §24 — calcul des parts en centimes entiers. La première part de
 * la liste retournée est toujours celle de l'organisateur (convention
 * interne, pas une règle CDC) — c'est la seule part payée immédiatement à la
 * création du SPLIT (CDC §26).
 */

export type SplitServiceFeeAllocation = "ORGANIZER" | "PRO_RATA";

export interface SplitShare {
  isOrganizer: boolean;
  baseAmountCents: number;
  serviceFeeAmountCents: number;
  totalAmountCents: number;
}

export interface ComputeSplitSharesInput {
  /** Prix total du terrain (hors frais de service), en centimes. */
  basePriceTotalCents: number;
  /** Nombre de parts — capacité du terrain utilisée pour ce SPLIT (CDC §23.3). */
  participantCount: number;
  /** 0 si le frais de service est désactivé. */
  serviceFeeCents: number;
  allocation: SplitServiceFeeAllocation;
}

export function computeSplitShares(input: ComputeSplitSharesInput): SplitShare[] {
  if (!Number.isInteger(input.participantCount) || input.participantCount <= 0) {
    throw new Error(`computeSplitShares: participantCount invalide (${input.participantCount})`);
  }

  const baseAmounts = splitEvenly(input.basePriceTotalCents, input.participantCount);

  // CDC §24.2 : allocation ORGANIZER = organisateur seul porte le frais ;
  // PRO_RATA = réparti entre toutes les parts (répartition en centimes
  // entiers, CDC §23.3, mêmes garanties que pour le prix du terrain).
  const feeAmounts =
    input.allocation === "ORGANIZER"
      ? [input.serviceFeeCents, ...Array(input.participantCount - 1).fill(0)]
      : splitEvenly(input.serviceFeeCents, input.participantCount);

  return baseAmounts.map((baseAmountCents, index) => ({
    isOrganizer: index === 0,
    baseAmountCents,
    serviceFeeAmountCents: feeAmounts[index] ?? 0,
    totalAmountCents: baseAmountCents + (feeAmounts[index] ?? 0),
  }));
}
