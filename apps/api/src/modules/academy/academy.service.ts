import { DateTime } from "luxon";
import { DISPLAY_TIMEZONE, AppError, ErrorCodes } from "@ardenne/shared";
import type { AcademyLessonStatus } from "@prisma/client";
import type { AcademyRepository } from "./academy.repository.js";
import type { AvailabilityService } from "../availability/availability.service.js";
import type { CourtsRepository } from "../courts/courts.repository.js";
import type { NotificationService } from "../notifications/notification.service.js";
import { computePossibleLessonSlots, type CourtAvailableSlot, type MinuteRange, type PossibleLessonSlot } from "./academy-scheduling.js";

function toMinuteRange(start: Date, end: Date, dayStart: DateTime): MinuteRange {
  const s = DateTime.fromJSDate(start).setZone(DISPLAY_TIMEZONE);
  const e = DateTime.fromJSDate(end).setZone(DISPLAY_TIMEZONE);
  return {
    startMinute: Math.max(0, s.diff(dayStart, "minutes").minutes),
    endMinute: Math.min(24 * 60, e.diff(dayStart, "minutes").minutes),
  };
}

function fromMinute(dayStart: DateTime, minute: number): Date {
  return dayStart.plus({ minutes: minute }).toJSDate();
}

export interface AddAvailabilityInput {
  startAt: string;
  endAt: string;
  recurrence?: unknown;
}

export interface ComputePossibleSlotsInput {
  teacherId: string;
  studentIds: string[];
  date: string;
  durationMinutes: number;
  courtIds: string[];
}

export interface ProposeLessonInput {
  teacherId: string;
  studentIds: string[];
  startAt: string;
  endAt: string;
}

/**
 * Orchestration Academy Phase A : disponibilités, moteur d'intersection
 * (délègue le calcul pur à `academy-scheduling.ts`), propositions de cours.
 * Consomme `AvailabilityService`/`CourtsRepository` existants — ne recrée
 * jamais un second moteur de disponibilité terrain (besoin urgent §10).
 */
export class AcademyService {
  constructor(
    private readonly repo: AcademyRepository,
    private readonly availability: AvailabilityService,
    private readonly courts: CourtsRepository,
    private readonly notifications: NotificationService,
  ) {}

  // --- Disponibilités ---------------------------------------------------

  addTeacherAvailability(teacherId: string, input: AddAvailabilityInput) {
    return this.repo.createAvailability({
      actorType: "TEACHER",
      teacherId,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      recurrence: input.recurrence,
    });
  }

  listTeacherAvailability(teacherId: string, fromISO: string, toISO: string) {
    return this.repo.listTeacherAvailability(teacherId, new Date(fromISO), new Date(toISO));
  }

  addStudentAvailability(studentId: string, input: AddAvailabilityInput) {
    return this.repo.createAvailability({
      actorType: "STUDENT",
      studentId,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      recurrence: input.recurrence,
    });
  }

  listStudentAvailability(studentId: string, fromISO: string, toISO: string) {
    return this.repo.listStudentAvailability(studentId, new Date(fromISO), new Date(toISO));
  }

  /** Supprime une disponibilité — vérifie que `ownerId` (prof ou élève) en est bien l'auteur avant suppression. */
  async deleteAvailability(id: string, owner: { teacherId?: string; studentId?: string }) {
    const availability = await this.repo.findAvailabilityById(id);
    if (!availability) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Disponibilité introuvable.", 404);
    }
    const isOwner =
      (owner.teacherId && availability.teacherId === owner.teacherId) || (owner.studentId && availability.studentId === owner.studentId);
    if (!isOwner) {
      throw new AppError(ErrorCodes.FORBIDDEN, "Cette disponibilité ne vous appartient pas.", 403);
    }
    await this.repo.deleteAvailability(id);
  }

  submitCourseRequest(studentId: string, input: { requestedHours: number; courseType: "INDIVIDUAL" | "GROUP" }) {
    return this.repo.createCourseRequest({ studentId, requestedHours: input.requestedHours, courseType: input.courseType });
  }

  // --- Moteur d'intersection ----------------------------------------------

  /** CDC §5, §11 : prof ∩ élève(s) ∩ terrain réel (via `AvailabilityService`, aucun second moteur). */
  async computePossibleSlots(input: ComputePossibleSlotsInput): Promise<PossibleLessonSlot[]> {
    const dayStart = DateTime.fromISO(input.date, { zone: DISPLAY_TIMEZONE }).startOf("day");
    if (!dayStart.isValid) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, `Date invalide "${input.date}".`, 422);
    }
    const dayEnd = dayStart.plus({ days: 1 });

    const teacherRows = await this.repo.listTeacherAvailability(input.teacherId, dayStart.toJSDate(), dayEnd.toJSDate());
    const teacherWindows = teacherRows.map((r) => toMinuteRange(r.startAt, r.endAt, dayStart));

    const studentWindowsByStudent: Record<string, MinuteRange[]> = {};
    for (const studentId of input.studentIds) {
      const rows = await this.repo.listStudentAvailability(studentId, dayStart.toJSDate(), dayEnd.toJSDate());
      studentWindowsByStudent[studentId] = rows.map((r) => toMinuteRange(r.startAt, r.endAt, dayStart));
    }

    const courtSlotsByCourt: Record<string, CourtAvailableSlot[]> = {};
    for (const courtId of input.courtIds) {
      const court = await this.courts.findById(courtId);
      if (!court || !court.active) continue;
      const slots = await this.availability.getAvailability(court, input.date);
      courtSlotsByCourt[courtId] = slots.map((s) => ({ courtId, startMinute: s.startMinute, allowedDurationsMinutes: s.allowedDurationsMinutes }));
    }

    return computePossibleLessonSlots({
      date: input.date,
      teacherId: input.teacherId,
      teacherWindows,
      studentIds: input.studentIds,
      studentWindowsByStudent,
      courtSlotsByCourt,
      durationMinutes: input.durationMinutes,
    });
  }

  // --- Cours (propositions) ------------------------------------------------

  /** Crée une proposition de cours (état `PROPOSED`) et notifie prof + élèves (§13, §16). N'est PAS une réservation de terrain garantie — cf. ACADEMY_MVP_SPEC.md §6. */
  async proposeLesson(input: ProposeLessonInput) {
    const lesson = await this.repo.createLesson({
      teacherId: input.teacherId,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      studentIds: input.studentIds,
      status: "PROPOSED",
    });

    await this.notifications.enqueue({
      template: "ACADEMY_LESSON_PROPOSED",
      recipientUserId: lesson.teacherId,
      payload: { lessonId: lesson.id, startAt: lesson.startAt.toISOString(), endAt: lesson.endAt.toISOString() },
    });
    for (const participant of lesson.participants) {
      await this.notifications.enqueue({
        template: "ACADEMY_LESSON_PROPOSED",
        recipientEmail: participant.student.email,
        payload: { lessonId: lesson.id, startAt: lesson.startAt.toISOString(), endAt: lesson.endAt.toISOString(), firstName: participant.student.firstName },
      });
    }

    return lesson;
  }

  private async transitionLesson(id: string, from: AcademyLessonStatus[], to: AcademyLessonStatus, template: "ACADEMY_LESSON_CONFIRMED" | "ACADEMY_LESSON_CANCELLED") {
    const lesson = await this.repo.findLessonById(id);
    if (!lesson) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Cours introuvable.", 404);
    }
    if (!from.includes(lesson.status)) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, `Transition invalide (état actuel : ${lesson.status}).`, 409);
    }

    await this.repo.updateLessonStatus(id, to);
    lesson.status = to;

    await this.notifications.enqueue({
      template,
      recipientUserId: lesson.teacherId,
      payload: { lessonId: lesson.id, startAt: lesson.startAt.toISOString(), endAt: lesson.endAt.toISOString() },
    });
    for (const participant of lesson.participants) {
      await this.notifications.enqueue({
        template,
        recipientEmail: participant.student.email,
        payload: { lessonId: lesson.id, startAt: lesson.startAt.toISOString(), endAt: lesson.endAt.toISOString(), firstName: participant.student.firstName },
      });
    }

    return lesson;
  }

  /**
   * Confirmation (§13) : passe `PROPOSED -> CONFIRMED`. Frontière volontaire
   * (§14, ACADEMY_MVP_SPEC.md §6) : aucune réservation de terrain n'est
   * déclenchée ici — `bookingId` reste `null` tant que la Phase B n'est pas
   * livrée. Ne jamais interpréter `CONFIRMED` comme une garantie de terrain.
   */
  confirmLesson(id: string) {
    return this.transitionLesson(id, ["PROPOSED"], "CONFIRMED", "ACADEMY_LESSON_CONFIRMED");
  }

  cancelLesson(id: string) {
    return this.transitionLesson(id, ["DRAFT", "PROPOSED", "CONFIRMED"], "CANCELLED", "ACADEMY_LESSON_CANCELLED");
  }

  listLessonsForTeacher(teacherId: string, fromISO: string, toISO: string) {
    return this.repo.listLessonsForTeacher(teacherId, new Date(fromISO), new Date(toISO));
  }

  listLessonsForStudent(studentId: string) {
    return this.repo.listLessonsForStudent(studentId);
  }
}

// Ré-exporté pour les routes (conversion minutes <-> Date côté frontière HTTP si besoin).
export { fromMinute };
