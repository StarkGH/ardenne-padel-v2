import { describe, expect, it } from "vitest";
import { mergeLightIntervals } from "./light-interval-merger.js";

describe("mergeLightIntervals", () => {
  it("returns an empty array for no input", () => {
    expect(mergeLightIntervals([])).toEqual([]);
  });

  it("keeps a single interval unchanged", () => {
    const start = new Date("2026-09-11T17:55:00.000Z");
    const end = new Date("2026-09-11T19:10:00.000Z");
    expect(mergeLightIntervals([{ start, end }])).toEqual([{ startsAt: start.toISOString(), endsAt: end.toISOString() }]);
  });

  it("merges two overlapping intervals into one", () => {
    const result = mergeLightIntervals([
      { start: new Date("2026-09-11T17:55:00.000Z"), end: new Date("2026-09-11T18:10:00.000Z") },
      { start: new Date("2026-09-11T18:05:00.000Z"), end: new Date("2026-09-11T19:10:00.000Z") },
    ]);
    expect(result).toEqual([{ startsAt: "2026-09-11T17:55:00.000Z", endsAt: "2026-09-11T19:10:00.000Z" }]);
  });

  it("merges two intervals that touch exactly at the boundary", () => {
    const result = mergeLightIntervals([
      { start: new Date("2026-09-11T17:00:00.000Z"), end: new Date("2026-09-11T18:00:00.000Z") },
      { start: new Date("2026-09-11T18:00:00.000Z"), end: new Date("2026-09-11T19:00:00.000Z") },
    ]);
    expect(result).toEqual([{ startsAt: "2026-09-11T17:00:00.000Z", endsAt: "2026-09-11T19:00:00.000Z" }]);
  });

  it("keeps two genuinely separate intervals apart", () => {
    const result = mergeLightIntervals([
      { start: new Date("2026-09-11T09:00:00.000Z"), end: new Date("2026-09-11T10:00:00.000Z") },
      { start: new Date("2026-09-11T18:00:00.000Z"), end: new Date("2026-09-11T19:00:00.000Z") },
    ]);
    expect(result).toHaveLength(2);
  });

  it("sorts unordered input before merging", () => {
    const result = mergeLightIntervals([
      { start: new Date("2026-09-11T19:00:00.000Z"), end: new Date("2026-09-11T20:00:00.000Z") },
      { start: new Date("2026-09-11T18:00:00.000Z"), end: new Date("2026-09-11T19:00:00.000Z") },
    ]);
    expect(result).toEqual([{ startsAt: "2026-09-11T18:00:00.000Z", endsAt: "2026-09-11T20:00:00.000Z" }]);
  });

  it("absorbs an interval fully contained in another", () => {
    const result = mergeLightIntervals([
      { start: new Date("2026-09-11T08:00:00.000Z"), end: new Date("2026-09-11T20:00:00.000Z") },
      { start: new Date("2026-09-11T10:00:00.000Z"), end: new Date("2026-09-11T11:00:00.000Z") },
    ]);
    expect(result).toEqual([{ startsAt: "2026-09-11T08:00:00.000Z", endsAt: "2026-09-11T20:00:00.000Z" }]);
  });
});
