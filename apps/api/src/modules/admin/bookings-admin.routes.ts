import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { BookingsAdminService } from "./bookings-admin.service.js";

const dashboardQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

const cancelSchema = z.object({ reason: z.string().min(1).max(500) });
const resyncSchema = z.object({ reason: z.string().max(500).optional() });
const createBookingSchema = z.object({
  organizerUserId: z.string().uuid(),
  courtId: z.string().uuid(),
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().positive(),
  paymentMode: z.enum(["FULL", "SPLIT"]).optional(),
});
const addParticipantSchema = z
  .object({
    displayName: z.string().min(1).max(100),
    userId: z.string().uuid().optional(),
    legacyClientId: z.string().optional(),
    invitedEmail: z.string().email().optional(),
  })
  .refine((v) => v.userId || v.legacyClientId || v.invitedEmail, {
    message: "Un participant doit référencer un utilisateur V2, un client Legacy, ou une invitation e-mail.",
  });

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

/** CDC §39.1-§39.2 — dashboard planning et actions rapides admin. */
export function createBookingsAdminRouter(service: BookingsAdminService): Router {
  const router = Router();

  router.get("/admin/bookings", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const { from, to } = parseOrThrow(dashboardQuerySchema, req.query);
      res.status(200).json({ data: await service.listForDashboard(from, to) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/legacy-bookings", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const { from, to } = parseOrThrow(dashboardQuerySchema, req.query);
      res.status(200).json({ data: await service.listLegacyForDashboard(from, to) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/access-grants", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const { from, to } = parseOrThrow(dashboardQuerySchema, req.query);
      res.status(200).json({ data: await service.listAccessGrants(from, to) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/bookings/:id", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.getById(req.params.id!) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/bookings", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(createBookingSchema, req.body);
      const booking = await service.adminCreate(input, req.authUser!.id);
      res.status(201).json({ data: booking });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/bookings/:id/cancel", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { reason } = parseOrThrow(cancelSchema, req.body);
      res.status(200).json({ data: await service.adminCancel(req.params.id!, req.authUser!.id, reason) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/bookings/:id/force-resync", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { reason } = parseOrThrow(resyncSchema, req.body ?? {});
      res.status(200).json({ data: await service.forceResync(req.params.id!, req.authUser!.id, reason) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/bookings/:id/participants", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(addParticipantSchema, req.body);
      const participant = await service.adminAddParticipant(req.params.id!, req.authUser!.id, input);
      res.status(201).json({ data: participant });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/admin/bookings/:id/participants/:participantId", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      await service.adminRemoveParticipant(req.params.id!, req.authUser!.id, req.params.participantId!);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
