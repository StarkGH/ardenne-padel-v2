import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { NextoreSplitService } from "./split.service.js";

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

const partsQuerySchema = z.object({ parts: z.coerce.number().int().positive() });

/**
 * CDC Nextore §13/§11 — split égal/libre (réutilise `POST .../payments` du
 * Lot E, taggué par `participantId` : pas de nouvel endpoint de paiement),
 * et synthèse par participant (SPL-008).
 */
export function createNextoreSplitRouter(service: NextoreSplitService): Router {
  const router = Router();

  router.get("/nextore/accounts/:id/split-preview", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const { parts } = parseOrThrow(partsQuerySchema, req.query);
      res.status(200).json({ data: await service.previewEqualSplit(req.params.id!, parts) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/nextore/accounts/:id/participants-summary", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.getParticipantsSummary(req.params.id!) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
