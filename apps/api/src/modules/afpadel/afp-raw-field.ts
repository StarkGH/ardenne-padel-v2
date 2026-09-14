/**
 * Lecture défensive d'un champ scalaire dans un blob JSON de forme inconnue
 * à l'avance (rawListData/rawPlayerData — structure AFPadel non garantie
 * dans le temps, même précaution que LegacyBooking.accessCodes).
 */
export function readRawString(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

/** Comme `readRawString`, mais pour un champ date (ex. "birthdate": "2009-04-17") — null si absent ou invalide. */
export function readRawDate(obj: unknown, key: string): Date | null {
  const raw = readRawString(obj, key);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
