import { DateTime } from "luxon";
import { DISPLAY_TIMEZONE } from "@ardenne/shared";
import type { Court } from "@prisma/client";
import type { AvailabilityRepository } from "./availability.repository.js";
import { computeAvailableSlots, timeStringToMinutes, type MinuteRange } from "./slot-calculator.js";

const DEFAULT_STEP_MINUTES = 30;

function toMinuteRange(start: Date, end: Date, dayStart: DateTime): MinuteRange {
  const s = DateTime.fromJSDate(start).setZone(DISPLAY_TIMEZONE);
  const e = DateTime.fromJSDate(end).setZone(DISPLAY_TIMEZONE);
  return {
    startMinute: Math.max(0, s.diff(dayStart, "minutes").minutes),
    endMinute: Math.min(24 * 60, e.diff(dayStart, "minutes").minutes),
  };
}

/**
 * CDC §10.2 : un visiteur non connecté doit pouvoir consulter les
 * disponibilités. Le résultat reste un indicateur (§10.3, §85) — la seule
 * garantie de disponibilité vient du POST Doinsport au moment du checkout.
 */
export class AvailabilityService {
  constructor(private readonly repo: AvailabilityRepository) {}

  async getAvailability(court: Court, dateISO: string) {
    const dayStart = DateTime.fromISO(dateISO, { zone: DISPLAY_TIMEZONE }).startOf("day");
    if (!dayStart.isValid) {
      throw new Error(`getAvailability: date invalide "${dateISO}" (${dayStart.invalidReason})`);
    }
    const dayEnd = dayStart.plus({ days: 1 });
    const dayOfWeek = dayStart.weekday % 7; // luxon 1=lundi..7=dimanche -> 0=dimanche..6=samedi (CDC)

    const [openingRules, durationRules, closures, occupying] = await Promise.all([
      this.repo.findOpeningRules(court.id, dayOfWeek, dayStart.toJSDate()),
      this.repo.findDurationRules(court.id, court.courtType, dayStart.toJSDate()),
      this.repo.findClosures(court.id, dayStart.toJSDate(), dayEnd.toJSDate()),
      this.repo.findOccupyingBookings(court.id, dayStart.toJSDate(), dayEnd.toJSDate()),
    ]);

    const openingWindows = openingRules.map((r) => ({
      startMinute: timeStringToMinutes(r.startTime),
      endMinute: timeStringToMinutes(r.endTime),
    }));

    const durationWindows = durationRules.map((r) => ({
      startMinute: timeStringToMinutes(r.startTime),
      endMinute: timeStringToMinutes(r.endTime),
      allowedDurationsMinutes: r.allowedDurationsMinutes,
    }));

    const blockedRanges: MinuteRange[] = [
      ...closures.map((c) => toMinuteRange(c.startAt, c.endAt, dayStart)),
      ...occupying.map((b) => toMinuteRange(b.startAt, b.endAt, dayStart)),
    ];

    if (!openingWindows.length) return [];

    return computeAvailableSlots({
      openingWindows,
      durationWindows,
      blockedRanges,
      stepMinutes: DEFAULT_STEP_MINUTES,
    });
  }
}
