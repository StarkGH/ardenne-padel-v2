import { describe, expect, it } from "vitest";
import { computeAvailableSlots, minutesToTimeString, timeStringToMinutes } from "./slot-calculator.js";

const H = timeStringToMinutes;

describe("computeAvailableSlots (CDC §10 — disponibilités)", () => {
  it("proposes slots within the opening window at the given step", () => {
    const slots = computeAvailableSlots({
      openingWindows: [{ startMinute: H("08:00"), endMinute: H("10:00") }],
      durationWindows: [{ startMinute: H("00:00"), endMinute: H("23:59"), allowedDurationsMinutes: [60] }],
      blockedRanges: [],
      stepMinutes: 60,
    });
    expect(slots.map((s) => minutesToTimeString(s.startMinute))).toEqual(["08:00", "09:00"]);
  });

  it("excludes a duration that would spill past the opening window", () => {
    const slots = computeAvailableSlots({
      openingWindows: [{ startMinute: H("08:00"), endMinute: H("09:30") }],
      durationWindows: [{ startMinute: H("00:00"), endMinute: H("23:59"), allowedDurationsMinutes: [60, 90] }],
      blockedRanges: [],
      stepMinutes: 30,
    });
    const at0830 = slots.find((s) => s.startMinute === H("08:30"));
    // 08:30 + 90min = 10:00, dépasse la fermeture à 09:30 -> seule 60min tient (08:30-09:30)
    expect(at0830?.allowedDurationsMinutes).toEqual([60]);
  });

  it("excludes any duration overlapping a blocked range (closure or existing booking, V2 or Legacy)", () => {
    const slots = computeAvailableSlots({
      openingWindows: [{ startMinute: H("08:00"), endMinute: H("12:00") }],
      durationWindows: [{ startMinute: H("00:00"), endMinute: H("23:59"), allowedDurationsMinutes: [60] }],
      blockedRanges: [{ startMinute: H("09:00"), endMinute: H("10:00") }],
      stepMinutes: 60,
    });
    const startTimes = slots.map((s) => minutesToTimeString(s.startMinute));
    expect(startTimes).toContain("08:00");
    expect(startTimes).not.toContain("09:00");
    expect(startTimes).toContain("10:00");
  });

  it("returns no slot when the entire window is blocked", () => {
    const slots = computeAvailableSlots({
      openingWindows: [{ startMinute: H("08:00"), endMinute: H("09:00") }],
      durationWindows: [{ startMinute: H("00:00"), endMinute: H("23:59"), allowedDurationsMinutes: [60] }],
      blockedRanges: [{ startMinute: H("07:00"), endMinute: H("12:00") }],
      stepMinutes: 30,
    });
    expect(slots).toHaveLength(0);
  });

  it("supports multiple allowed durations per slot, filtering only the ones that fit", () => {
    const slots = computeAvailableSlots({
      openingWindows: [{ startMinute: H("08:00"), endMinute: H("10:00") }],
      durationWindows: [{ startMinute: H("00:00"), endMinute: H("23:59"), allowedDurationsMinutes: [30, 60, 90, 120] }],
      blockedRanges: [],
      stepMinutes: 30,
    });
    const at0800 = slots.find((s) => s.startMinute === H("08:00"));
    expect(at0800?.allowedDurationsMinutes).toEqual([30, 60, 90, 120]); // tient exactement dans 08:00-10:00
  });

  it("never proposes a slot outside any opening window", () => {
    const slots = computeAvailableSlots({
      openingWindows: [{ startMinute: H("08:00"), endMinute: H("09:00") }],
      durationWindows: [{ startMinute: H("00:00"), endMinute: H("23:59"), allowedDurationsMinutes: [30] }],
      blockedRanges: [],
      stepMinutes: 30,
    });
    for (const s of slots) {
      expect(s.startMinute).toBeGreaterThanOrEqual(H("08:00"));
      expect(s.startMinute).toBeLessThan(H("09:00"));
    }
  });
});
