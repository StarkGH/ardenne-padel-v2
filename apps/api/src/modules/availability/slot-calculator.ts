/**
 * Calcul pur des créneaux disponibles (CDC §10). Aucune dépendance DB/réseau
 * ici — c'est ce qui rend la logique testable par fixtures. La fonction
 * consomme des données déjà résolues pour **une seule journée locale** (les
 * heures sont en minutes depuis minuit, Europe/Brussels) ; la résolution de
 * fuseau/DST se fait en amont, dans le service qui appelle ce module.
 */

export interface MinuteRange {
  startMinute: number;
  endMinute: number;
}

export type OpeningWindow = MinuteRange;

export interface DurationWindow extends MinuteRange {
  allowedDurationsMinutes: number[];
}

export interface ComputeAvailableSlotsInput {
  openingWindows: OpeningWindow[];
  durationWindows: DurationWindow[];
  /** Fermetures + occupations Legacy et V2 déjà fusionnées (CDC §10.3 : une seule liste, peu importe la source). */
  blockedRanges: MinuteRange[];
  /** Granularité d'affichage des heures de début proposées. */
  stepMinutes: number;
}

export interface AvailableSlot {
  startMinute: number;
  allowedDurationsMinutes: number[];
}

function rangesOverlap(a: MinuteRange, b: MinuteRange): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

function isWithinAnyWindow(range: MinuteRange, windows: MinuteRange[]): boolean {
  return windows.some((w) => range.startMinute >= w.startMinute && range.endMinute <= w.endMinute);
}

function allowedDurationsAt(startMinute: number, durationWindows: DurationWindow[]): number[] {
  const durations = new Set<number>();
  for (const w of durationWindows) {
    if (startMinute >= w.startMinute && startMinute < w.endMinute) {
      for (const d of w.allowedDurationsMinutes) durations.add(d);
    }
  }
  return [...durations].sort((a, b) => a - b);
}

/**
 * Un créneau [start, start+duration) n'est retenu que s'il est entièrement
 * contenu dans une plage d'ouverture ET ne chevauche aucune plage bloquée
 * (fermeture ou occupation, V2 ou Legacy — CDC §10.3).
 */
export function computeAvailableSlots(input: ComputeAvailableSlotsInput): AvailableSlot[] {
  const slots: AvailableSlot[] = [];

  const dayStart = Math.min(...input.openingWindows.map((w) => w.startMinute), 0);
  const dayEnd = Math.max(...input.openingWindows.map((w) => w.endMinute), 24 * 60);

  for (let start = dayStart; start < dayEnd; start += input.stepMinutes) {
    const candidateDurations = allowedDurationsAt(start, input.durationWindows);
    if (!candidateDurations.length) continue;

    const validDurations = candidateDurations.filter((duration) => {
      const range: MinuteRange = { startMinute: start, endMinute: start + duration };
      if (!isWithinAnyWindow(range, input.openingWindows)) return false;
      if (input.blockedRanges.some((blocked) => rangesOverlap(range, blocked))) return false;
      return true;
    });

    if (validDurations.length) {
      slots.push({ startMinute: start, allowedDurationsMinutes: validDurations });
    }
  }

  return slots;
}

export function timeStringToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}
