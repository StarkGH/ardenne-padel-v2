import { DateTime } from "luxon";

/** CDC §79 : affichage en Europe/Brussels, quel que soit le fuseau du navigateur. */
export const DISPLAY_TIMEZONE = "Europe/Brussels";

export function combineDateAndTimeToIso(dateISO: string, timeHHmm: string): string {
  const dt = DateTime.fromFormat(`${dateISO} ${timeHHmm}`, "yyyy-MM-dd HH:mm", { zone: DISPLAY_TIMEZONE });
  return dt.toUTC().toISO()!;
}

export function nextNDays(n: number): DateTime[] {
  const today = DateTime.now().setZone(DISPLAY_TIMEZONE).startOf("day");
  return Array.from({ length: n }, (_, i) => today.plus({ days: i }));
}

export function formatDayLabel(dt: DateTime): string {
  return dt.setLocale("fr").toFormat("EEE d MMM");
}

export function formatDateTime(iso: string): string {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(DISPLAY_TIMEZONE).setLocale("fr").toFormat("EEEE d MMMM 'à' HH:mm");
}

export function formatDate(iso: string): string {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(DISPLAY_TIMEZONE).setLocale("fr").toFormat("d MMMM yyyy");
}

export function formatTimeRange(startIso: string, endIso: string): string {
  const start = DateTime.fromISO(startIso, { zone: "utc" }).setZone(DISPLAY_TIMEZONE);
  const end = DateTime.fromISO(endIso, { zone: "utc" }).setZone(DISPLAY_TIMEZONE);
  return `${start.toFormat("HH:mm")} – ${end.toFormat("HH:mm")}`;
}
