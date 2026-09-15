import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import { requireAcademyStudentToken } from "./academy-token-middleware.js";
import { minutesToTimeString } from "../availability/slot-calculator.js";
import type { AcademyService } from "./academy.service.js";
import type { AcademyInvitationService } from "./academy-invitation.service.js";

const availabilitySchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  recurrence: z.unknown().optional(),
});

const rangeQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

const createInvitationSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email(),
  phone: z.string().min(3).max(30).optional(),
});

const courseRequestSchema = z.object({
  requestedHours: z.coerce.number().positive().max(1000),
  courseType: z.enum(["INDIVIDUAL", "GROUP"]),
});

const possibleSlotsQuerySchema = z.object({
  teacherId: z.string().uuid(),
  studentIds: z
    .string()
    .min(1)
    .transform((v) => v.split(",")),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date attendue au format YYYY-MM-DD"),
  durationMinutes: z.coerce.number().int().positive(),
  courtIds: z
    .string()
    .min(1)
    .transform((v) => v.split(",")),
});

const proposeLessonSchema = z.object({
  teacherId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).min(1),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
});

function parseOrThrow<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

/**
 * Endpoints Academy Phase A (MVP disponibilités — ACADEMY_MVP_SPEC.md).
 * Trois surfaces d'accès distinctes :
 *  - `requireRole("COACH")` : le prof gère ses propres disponibilités ;
 *  - `requireRole("STAFF")` : admin/staff gère les invitations élève et les propositions ;
 *  - `requireAcademyStudentToken` : l'élève, via son lien temporaire, sans compte V2 (§8).
 */
export function createAcademyRouter(service: AcademyService, invitations: AcademyInvitationService): Router {
  const router = Router();

  // --- Prof ---------------------------------------------------------------

  router.post("/academy/teacher-availability", requireAuth, requireRole("COACH"), async (req, res, next) => {
    try {
      const body = parseOrThrow(availabilitySchema, req.body);
      const availability = await service.addTeacherAvailability(req.authUser!.id, body);
      res.status(201).json({ data: availability });
    } catch (err) {
      next(err);
    }
  });

  router.get("/academy/teacher-availability", requireAuth, requireRole("COACH"), async (req, res, next) => {
    try {
      const query = parseOrThrow(rangeQuerySchema, req.query);
      // Un coach ne consulte que ses propres disponibilités ; staff/admin peuvent passer teacherId en query.
      const teacherId = req.authUser!.role === "COACH" ? req.authUser!.id : (req.query.teacherId as string) || req.authUser!.id;
      const rows = await service.listTeacherAvailability(teacherId, query.from, query.to);
      res.status(200).json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/academy/teacher-availability/:id", requireAuth, requireRole("COACH"), async (req, res, next) => {
    try {
      await service.deleteAvailability(req.params.id!, { teacherId: req.authUser!.id });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.get("/academy/lessons/teacher", requireAuth, requireRole("COACH"), async (req, res, next) => {
    try {
      const query = parseOrThrow(rangeQuerySchema, req.query);
      const lessons = await service.listLessonsForTeacher(req.authUser!.id, query.from, query.to);
      res.status(200).json({ data: lessons });
    } catch (err) {
      next(err);
    }
  });

  // --- Admin / staff --------------------------------------------------------

  router.post("/academy/invitations", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const body = parseOrThrow(createInvitationSchema, req.body);
      const { studentId } = await invitations.createInvitation(body);
      // Le token brut n'est jamais renvoyé ici : il part uniquement par e-mail (§8 — pas d'exposition côté staff).
      res.status(201).json({ data: { studentId } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/academy/lessons", requireAuth, requireRole("COACH"), async (req, res, next) => {
    try {
      const body = parseOrThrow(proposeLessonSchema, req.body);
      if (req.authUser!.role === "COACH" && body.teacherId !== req.authUser!.id) {
        throw new AppError(ErrorCodes.FORBIDDEN, "Un coach ne peut proposer un cours qu'en son propre nom.", 403);
      }
      const lesson = await service.proposeLesson(body);
      res.status(201).json({ data: lesson });
    } catch (err) {
      next(err);
    }
  });

  router.post("/academy/lessons/:id/confirm", requireAuth, requireRole("COACH"), async (req, res, next) => {
    try {
      const lesson = await service.confirmLesson(req.params.id!);
      res.status(200).json({ data: lesson });
    } catch (err) {
      next(err);
    }
  });

  router.post("/academy/lessons/:id/cancel", requireAuth, requireRole("COACH"), async (req, res, next) => {
    try {
      const lesson = await service.cancelLesson(req.params.id!);
      res.status(200).json({ data: lesson });
    } catch (err) {
      next(err);
    }
  });

  // --- Moteur d'intersection (§5, §11) — consultable par le prof/staff ----

  router.get("/academy/possible-slots", requireAuth, requireRole("COACH"), async (req, res, next) => {
    try {
      const query = parseOrThrow(possibleSlotsQuerySchema, req.query);
      const slots = await service.computePossibleSlots(query);
      res.status(200).json({
        data: slots.map((s) => ({
          ...s,
          startTime: minutesToTimeString(s.startMinute),
          endTime: minutesToTimeString(s.endMinute),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // --- Élève (accès temporaire par token, §8, §9) ---------------------------

  router.get("/academy/invitations/:token", async (req, res, next) => {
    try {
      const student = await invitations.resolveInvitation(req.params.token!);
      res.status(200).json({ data: { firstName: student.firstName, email: student.email } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/academy/student-availability", requireAcademyStudentToken(invitations), async (req, res, next) => {
    try {
      const body = parseOrThrow(availabilitySchema, req.body);
      const availability = await service.addStudentAvailability(req.academyStudent!.id, body);
      res.status(201).json({ data: availability });
    } catch (err) {
      next(err);
    }
  });

  router.get("/academy/student-availability", requireAcademyStudentToken(invitations), async (req, res, next) => {
    try {
      const query = parseOrThrow(rangeQuerySchema, req.query);
      const rows = await service.listStudentAvailability(req.academyStudent!.id, query.from, query.to);
      res.status(200).json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/academy/student-availability/:id", requireAcademyStudentToken(invitations), async (req, res, next) => {
    try {
      await service.deleteAvailability(req.params.id!, { studentId: req.academyStudent!.id });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post("/academy/course-requests", requireAcademyStudentToken(invitations), async (req, res, next) => {
    try {
      const body = parseOrThrow(courseRequestSchema, req.body);
      const request = await service.submitCourseRequest(req.academyStudent!.id, body);
      res.status(201).json({ data: request });
    } catch (err) {
      next(err);
    }
  });

  router.get("/academy/my-lessons", requireAcademyStudentToken(invitations), async (req, res, next) => {
    try {
      const lessons = await service.listLessonsForStudent(req.academyStudent!.id);
      res.status(200).json({ data: lessons });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
