import { DateTime } from "luxon";

/**
 * Stockage interne : toujours UTC. Présentation : Europe/Brussels (CDC §79).
 * Attention DST — utiliser exclusivement ces helpers plutôt que Date natif
 * pour toute conversion touchant l'affichage ou les règles horaires.
 */
export const DISPLAY_TIMEZONE = "Europe/Brussels";

export function nowUtc(): DateTime {
  return DateTime.utc();
}

export function toDisplayTimezone(utcIso: string): DateTime {
  return DateTime.fromISO(utcIso, { zone: "utc" }).setZone(DISPLAY_TIMEZONE);
}

export function fromDisplayTimezoneToUtcIso(localIso: string): string {
  const dt = DateTime.fromISO(localIso, { zone: DISPLAY_TIMEZONE });
  if (!dt.isValid) {
    throw new Error(`fromDisplayTimezoneToUtcIso: date invalide "${localIso}" (${dt.invalidReason})`);
  }
  return dt.toUTC().toISO() as string;
}

export function isValidIsoDateTime(value: string): boolean {
  return DateTime.fromISO(value).isValid;
}
