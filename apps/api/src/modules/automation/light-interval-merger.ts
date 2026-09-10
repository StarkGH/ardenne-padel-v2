export interface RawInterval {
  start: Date;
  end: Date;
}

export interface MergedInterval {
  startsAt: string;
  endsAt: string;
}

/**
 * Éclairage (dossier technique §42) : deux réservations qui se chevauchent
 * ou se suivent (une fois la marge avant/après appliquée) doivent produire
 * un seul intervalle continu, jamais un flicker OFF/ON entre deux créneaux
 * consécutifs. `<=` (pas `<`) fusionne aussi deux intervalles qui se
 * touchent exactement à la microseconde près.
 */
export function mergeLightIntervals(raw: RawInterval[]): MergedInterval[] {
  if (raw.length === 0) return [];
  const sorted = [...raw].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: RawInterval[] = [{ start: sorted[0]!.start, end: sorted[0]!.end }];

  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (current.start.getTime() <= last.end.getTime()) {
      if (current.end.getTime() > last.end.getTime()) last.end = current.end;
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }

  return merged.map((i) => ({ startsAt: i.start.toISOString(), endsAt: i.end.toISOString() }));
}
