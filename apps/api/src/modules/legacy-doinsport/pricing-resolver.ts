import { DateTime } from "luxon";
import { DISPLAY_TIMEZONE } from "@ardenne/shared";
import type { LegacyPriceReference } from "./types.js";

/**
 * Port fidèle de l'algorithme audité (`padel-service/doinsport.js`,
 * `resolveTimetableBlockPrice`) — voir CDC §13.5, §74. Logique **Legacy
 * uniquement** : ne doit jamais contaminer le futur moteur tarifaire V2
 * (Lot 3), qui aura sa propre résolution à priorité explicite.
 */

export interface TimetableBlockDto {
  id: string;
  /** Plage horaire récurrente quotidienne — seule l'heure compte (date fixe 1970-01-01, CDC §13.5). */
  startAt: string;
  endAt: string;
  createdAt: string;
  priceIds: string[];
}

export interface TimetableBlockPriceDto {
  id: string;
  pricePerParticipant: number | null;
  /** Durée en secondes. */
  duration: number;
}

export interface ResolveBlockPriceInput {
  blocks: TimetableBlockDto[];
  prices: TimetableBlockPriceDto[];
  startAt: string;
  durationSeconds: number;
}

function timeOfDay(iso: string): string {
  // "1970-01-01T08:00:00+00:00" -> "08:00:00"
  return iso.slice(11, 19);
}

export class NoTimetableBlockCoversTimeError extends Error {}
export class NoPriceForDurationError extends Error {}

/**
 * Résout le `timetableBlockPriceId` applicable pour un terrain/horaire/durée
 * donnés, à partir de blocs et prix déjà récupérés (aucun accès réseau ici —
 * c'est ce qui rend la fonction testable par fixtures).
 *
 * Règle (confirmée manuellement, CDC §13.5) : quand plusieurs blocs de
 * grilles horaires différentes couvrent la même heure, le bloc le plus
 * récemment créé (`createdAt`) prévaut. S'il ne propose pas la durée
 * demandée, on retombe sur le bloc suivant par ancienneté plutôt que
 * d'échouer immédiatement (ex. bloc promo à durée fixe).
 */
export function resolveBlockPrice(input: ResolveBlockPriceInput): { block: TimetableBlockDto; price: TimetableBlockPriceDto } {
  const localTime = DateTime.fromISO(input.startAt, { setZone: true }).setZone(DISPLAY_TIMEZONE).toFormat("HH:mm:ss");

  const candidates = input.blocks.filter((block) => {
    const start = timeOfDay(block.startAt);
    const end = timeOfDay(block.endAt);
    return localTime >= start && localTime < end;
  });

  if (!candidates.length) {
    throw new NoTimetableBlockCoversTimeError(`Aucun bloc horaire ne couvre ${localTime}`);
  }

  const sorted = [...candidates].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  for (const block of sorted) {
    const blockPriceIds = new Set(block.priceIds);
    const match = input.prices.find((p) => blockPriceIds.has(p.id) && p.duration === input.durationSeconds);
    if (match) {
      return { block, price: match };
    }
  }

  throw new NoPriceForDurationError(
    `Aucun tarif de ${input.durationSeconds}s trouvé pour ${localTime} (${sorted.length} bloc(s) couvrant cet horaire testé(s))`,
  );
}

export function toLegacyPriceReference(
  resolved: { block: TimetableBlockDto; price: TimetableBlockPriceDto },
  activityId: string,
): LegacyPriceReference {
  return {
    timetableBlockPriceId: resolved.price.id,
    activityId,
    pricePerParticipant: resolved.price.pricePerParticipant,
    currency: "EUR",
  };
}
