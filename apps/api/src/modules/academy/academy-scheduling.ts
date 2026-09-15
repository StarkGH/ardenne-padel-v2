/**
 * Moteur d'intersection Academy (besoin urgent §5, §11) :
 *
 *   PROF DISPONIBLE ∩ ÉLÈVE(S) DISPONIBLE(S) ∩ TERRAIN DISPONIBLE = CRÉNEAU POSSIBLE
 *
 * Fonction pure, aucune dépendance DB/réseau ici (même principe que
 * `slot-calculator.ts` côté `availability`) — les disponibilités prof/élève
 * et les créneaux terrain réels sont déjà résolus en amont par
 * `AcademyService`, pour une seule journée locale (minutes depuis minuit).
 * Volontairement PAS l'algorithme d'arbitrage complet du CDC historique
 * (Gale-Shapley/Hongrois, scoring, quorum) — cf. ACADEMY_MVP_SPEC.md : le
 * MVP est une simple intersection, testable et explicable.
 */

export interface MinuteRange {
  startMinute: number;
  endMinute: number;
}

/** Sortie de `AvailabilityService.getAvailability` pour un terrain donné, ce jour-là. */
export interface CourtAvailableSlot {
  courtId: string;
  startMinute: number;
  allowedDurationsMinutes: number[];
}

export interface PossibleLessonSlot {
  date: string;
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  teacherId: string;
  studentIds: string[];
  courtIds: string[];
}

export interface ComputePossibleLessonSlotsInput {
  date: string;
  teacherId: string;
  /** Disponibilités déclarées du prof, ce jour-là. */
  teacherWindows: MinuteRange[];
  /** Un élève au moins requis ; toutes les disponibilités listées doivent être satisfaites simultanément (cours à plusieurs = tous dispo en même temps). */
  studentIds: string[];
  studentWindowsByStudent: Record<string, MinuteRange[]>;
  /** Créneaux réels par terrain (déjà calculés via `AvailabilityService`), terrains candidats uniquement. */
  courtSlotsByCourt: Record<string, CourtAvailableSlot[]>;
  durationMinutes: number;
}

function rangesOverlap(a: MinuteRange, b: MinuteRange): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

function intersectRange(a: MinuteRange, b: MinuteRange): MinuteRange | null {
  const startMinute = Math.max(a.startMinute, b.startMinute);
  const endMinute = Math.min(a.endMinute, b.endMinute);
  return startMinute < endMinute ? { startMinute, endMinute } : null;
}

/** Intersecte deux listes de plages disjointes (produit croisé + fusion des chevauchements). */
function intersectRangeLists(a: MinuteRange[], b: MinuteRange[]): MinuteRange[] {
  const result: MinuteRange[] = [];
  for (const ra of a) {
    for (const rb of b) {
      const overlap = intersectRange(ra, rb);
      if (overlap) result.push(overlap);
    }
  }
  return result;
}

/**
 * Calcule les créneaux de cours possibles : intersection temporelle prof ∩
 * tous les élèves, puis, dans chaque fenêtre commune, les créneaux terrain
 * réels qui acceptent la durée demandée et démarrent dans la fenêtre.
 */
export function computePossibleLessonSlots(input: ComputePossibleLessonSlotsInput): PossibleLessonSlot[] {
  if (input.studentIds.length === 0) {
    return [];
  }

  let commonWindows: MinuteRange[] = input.teacherWindows;
  for (const studentId of input.studentIds) {
    const studentWindows = input.studentWindowsByStudent[studentId] ?? [];
    commonWindows = intersectRangeLists(commonWindows, studentWindows);
    if (commonWindows.length === 0) break;
  }

  if (commonWindows.length === 0) {
    return [];
  }

  const slots: PossibleLessonSlot[] = [];

  for (const [courtId, courtSlots] of Object.entries(input.courtSlotsByCourt)) {
    for (const slot of courtSlots) {
      if (!slot.allowedDurationsMinutes.includes(input.durationMinutes)) continue;

      const lessonRange: MinuteRange = { startMinute: slot.startMinute, endMinute: slot.startMinute + input.durationMinutes };
      const fitsCommonWindow = commonWindows.some((w) => w.startMinute <= lessonRange.startMinute && w.endMinute >= lessonRange.endMinute);
      if (!fitsCommonWindow) continue;

      const existing = slots.find((s) => s.startMinute === lessonRange.startMinute && s.endMinute === lessonRange.endMinute);
      if (existing) {
        existing.courtIds.push(courtId);
      } else {
        slots.push({
          date: input.date,
          startMinute: lessonRange.startMinute,
          endMinute: lessonRange.endMinute,
          durationMinutes: input.durationMinutes,
          teacherId: input.teacherId,
          studentIds: input.studentIds,
          courtIds: [courtId],
        });
      }
    }
  }

  return slots.sort((a, b) => a.startMinute - b.startMinute);
}

// Exporté pour les tests / la construction des fenêtres côté service.
export { rangesOverlap };
