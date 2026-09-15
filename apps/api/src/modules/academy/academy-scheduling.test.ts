import { describe, expect, it } from "vitest";
import { computePossibleLessonSlots } from "./academy-scheduling.js";
import { timeStringToMinutes as H } from "../availability/slot-calculator.js";

describe("computePossibleLessonSlots (Academy MVP §5, §11 — prof ∩ élève ∩ terrain)", () => {
  it("returns a slot when teacher, student and a court all overlap for the requested duration", () => {
    const slots = computePossibleLessonSlots({
      date: "2026-10-05",
      teacherId: "teacher-1",
      teacherWindows: [{ startMinute: H("17:00"), endMinute: H("22:00") }],
      studentIds: ["student-1"],
      studentWindowsByStudent: {
        "student-1": [{ startMinute: H("18:00"), endMinute: H("20:00") }],
      },
      courtSlotsByCourt: {
        "court-1": [
          { courtId: "court-1", startMinute: H("18:00"), allowedDurationsMinutes: [60, 90] },
          { courtId: "court-1", startMinute: H("18:30"), allowedDurationsMinutes: [60] },
        ],
      },
      durationMinutes: 60,
    });

    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({
      startMinute: H("18:00"),
      endMinute: H("19:00"),
      durationMinutes: 60,
      teacherId: "teacher-1",
      studentIds: ["student-1"],
      courtIds: ["court-1"],
    });
  });

  it("excludes a court slot that would spill past the common teacher/student window", () => {
    const slots = computePossibleLessonSlots({
      date: "2026-10-05",
      teacherId: "teacher-1",
      teacherWindows: [{ startMinute: H("17:00"), endMinute: H("19:00") }],
      studentIds: ["student-1"],
      studentWindowsByStudent: {
        "student-1": [{ startMinute: H("18:00"), endMinute: H("20:00") }],
      },
      courtSlotsByCourt: {
        "court-1": [{ courtId: "court-1", startMinute: H("18:30"), allowedDurationsMinutes: [60] }],
      },
      durationMinutes: 60,
    });

    // Fenêtre commune prof∩élève = 18:00-19:00 ; 18:30+60min = 19:30 dépasse.
    expect(slots).toHaveLength(0);
  });

  it("requires ALL listed students to be simultaneously available (cours collectif)", () => {
    const slots = computePossibleLessonSlots({
      date: "2026-10-05",
      teacherId: "teacher-1",
      teacherWindows: [{ startMinute: H("17:00"), endMinute: H("22:00") }],
      studentIds: ["student-1", "student-2"],
      studentWindowsByStudent: {
        "student-1": [{ startMinute: H("18:00"), endMinute: H("20:00") }],
        "student-2": [{ startMinute: H("19:00"), endMinute: H("21:00") }],
      },
      courtSlotsByCourt: {
        "court-1": [{ courtId: "court-1", startMinute: H("19:00"), allowedDurationsMinutes: [60] }],
      },
      durationMinutes: 60,
    });

    // Fenêtre commune = intersection des 3 = 19:00-20:00.
    expect(slots).toHaveLength(1);
    expect(slots[0]?.startMinute).toBe(H("19:00"));
  });

  it("returns no slot when a required student has no availability at all that day", () => {
    const slots = computePossibleLessonSlots({
      date: "2026-10-05",
      teacherId: "teacher-1",
      teacherWindows: [{ startMinute: H("17:00"), endMinute: H("22:00") }],
      studentIds: ["student-1"],
      studentWindowsByStudent: {},
      courtSlotsByCourt: {
        "court-1": [{ courtId: "court-1", startMinute: H("18:00"), allowedDurationsMinutes: [60] }],
      },
      durationMinutes: 60,
    });

    expect(slots).toHaveLength(0);
  });

  it("merges multiple compatible courts into the same slot's courtIds", () => {
    const slots = computePossibleLessonSlots({
      date: "2026-10-05",
      teacherId: "teacher-1",
      teacherWindows: [{ startMinute: H("17:00"), endMinute: H("22:00") }],
      studentIds: ["student-1"],
      studentWindowsByStudent: {
        "student-1": [{ startMinute: H("17:00"), endMinute: H("22:00") }],
      },
      courtSlotsByCourt: {
        "court-1": [{ courtId: "court-1", startMinute: H("18:00"), allowedDurationsMinutes: [60] }],
        "court-2": [{ courtId: "court-2", startMinute: H("18:00"), allowedDurationsMinutes: [60] }],
      },
      durationMinutes: 60,
    });

    expect(slots).toHaveLength(1);
    expect(slots[0]?.courtIds.sort()).toEqual(["court-1", "court-2"]);
  });

  it("filters out a court slot that does not allow the requested duration", () => {
    const slots = computePossibleLessonSlots({
      date: "2026-10-05",
      teacherId: "teacher-1",
      teacherWindows: [{ startMinute: H("17:00"), endMinute: H("22:00") }],
      studentIds: ["student-1"],
      studentWindowsByStudent: {
        "student-1": [{ startMinute: H("17:00"), endMinute: H("22:00") }],
      },
      courtSlotsByCourt: {
        "court-1": [{ courtId: "court-1", startMinute: H("18:00"), allowedDurationsMinutes: [90] }],
      },
      durationMinutes: 60,
    });

    expect(slots).toHaveLength(0);
  });
});
