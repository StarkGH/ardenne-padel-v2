import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { NextoreCashSessionService } from "./cash-session.service.js";

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

const openSchema = z.object({ declaredOpeningCents: z.number().int().nonnegative() });
const movementSchema = z.object({ type: z.enum(["IN", "OUT"]), amountCents: z.number().int().positive(), reason: z.string().min(1) });
const closeSchema = z.object({ declaredClosingCents: z.number().int().nonnegative(), justification: z.string().optional() });

/** CDC Nextore §15 — sessions de caisse. */
export function createNextoreCashSessionRouter(service: NextoreCashSessionService): Router {
  const router = Router();

  router.get("/nextore/cash-sessions/current", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      const session = await service.getCurrentOpenSession();
      res.status(200).json({ data: session });
    } catch (err) {
      next(err);
    }
  });

  router.post("/nextore/cash-sessions", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const input = parseOrThrow(openSchema, req.body);
      const session = await service.openSession({ ...input, openedByUserId: req.authUser!.id });
      res.status(201).json({ data: session });
    } catch (err) {
      next(err);
    }
  });

  router.get("/nextore/cash-sessions/:id", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.getSession(req.params.id!) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/nextore/cash-sessions/:id/report", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.getSessionReport(req.params.id!) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/nextore/cash-sessions/:id/movements", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const input = parseOrThrow(movementSchema, req.body);
      const movement = await service.recordMovement({ sessionId: req.params.id!, createdByUserId: req.authUser!.id, ...input });
      res.status(201).json({ data: movement });
    } catch (err) {
      next(err);
    }
  });

  // CASH-006/008 — clôture réservée au rôle manager (écarts, corrections sensibles, CDC §27).
  router.post("/nextore/cash-sessions/:id/close", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(closeSchema, req.body);
      const session = await service.closeSession({ sessionId: req.params.id!, closedByUserId: req.authUser!.id, ...input });
      res.status(200).json({ data: session });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
