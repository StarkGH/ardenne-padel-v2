import { assertCents } from "@ardenne/shared";
import { timeStringToMinutes } from "../availability/slot-calculator.js";

/**
 * Moteur tarifaire V2 (CDC §11.1-§11.2). Résolution **déterministe** par
 * priorité explicite — jamais déduite d'un `createdAt` (contrairement au
 * resolver Legacy, CDC §74, qui reste isolé dans `legacy-doinsport`).
 */

export type CourtTypeFilter = "SIMPLE" | "DOUBLE" | null;

export interface TariffRuleCandidate {
  id: string;
  courtId: string | null;
  courtType: CourtTypeFilter;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  durationMinutes: number;
  priceTotalCents: number | null;
  pricePerParticipantCents: number | null;
  referenceCapacity: number;
  priority: number;
}

export interface ResolveTariffInput {
  courtId: string;
  courtType: CourtTypeFilter;
  dayOfWeek: number;
  startTime: string;
  durationMinutes: number;
  rules: TariffRuleCandidate[];
}

export interface ResolvedTariff {
  ruleId: string;
  priceTotalCents: number;
  pricePerParticipantCents: number;
  currency: "EUR";
}

export class NoTariffRuleFoundError extends Error {}

function matches(rule: TariffRuleCandidate, input: ResolveTariffInput): boolean {
  if (rule.courtId !== null && rule.courtId !== input.courtId) return false;
  if (rule.courtType !== null && rule.courtType !== input.courtType) return false;
  if (!rule.daysOfWeek.includes(input.dayOfWeek)) return false;
  if (rule.durationMinutes !== input.durationMinutes) return false;

  const start = timeStringToMinutes(rule.startTime);
  const end = timeStringToMinutes(rule.endTime);
  const requested = timeStringToMinutes(input.startTime);
  return requested >= start && requested < end;
}

/**
 * Priorité explicite décroissante ; à priorité égale (config ambiguë), le
 * choix retombe sur l'`id` pour rester déterministe plutôt que d'échouer —
 * une vraie ambiguïté de configuration est un problème d'hygiène de
 * configuration à corriger côté admin, pas une raison de casser le checkout.
 */
function pickWinningRule(candidates: TariffRuleCandidate[]): TariffRuleCandidate {
  return [...candidates].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0]!;
}

export function resolveTariff(input: ResolveTariffInput): ResolvedTariff {
  const candidates = input.rules.filter((r) => matches(r, input));
  if (!candidates.length) {
    throw new NoTariffRuleFoundError(
      `Aucune règle tarifaire ne couvre terrain=${input.courtId} jour=${input.dayOfWeek} heure=${input.startTime} durée=${input.durationMinutes}min`,
    );
  }

  const rule = pickWinningRule(candidates);

  let priceTotalCents: number;
  let pricePerParticipantCents: number;

  if (rule.priceTotalCents !== null) {
    priceTotalCents = rule.priceTotalCents;
    pricePerParticipantCents = Math.round(rule.priceTotalCents / rule.referenceCapacity);
  } else if (rule.pricePerParticipantCents !== null) {
    pricePerParticipantCents = rule.pricePerParticipantCents;
    priceTotalCents = rule.pricePerParticipantCents * rule.referenceCapacity;
  } else {
    throw new Error(`TariffRule ${rule.id} invalide : ni priceTotalCents ni pricePerParticipantCents défini.`);
  }

  assertCents(priceTotalCents, "priceTotalCents");
  assertCents(pricePerParticipantCents, "pricePerParticipantCents");

  return { ruleId: rule.id, priceTotalCents, pricePerParticipantCents, currency: "EUR" };
}
