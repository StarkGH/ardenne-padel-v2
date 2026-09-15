import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { NextoreReconciliationService } from "./reconciliation.service.js";

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

const importSchema = z.object({
  sourceFilename: z.string().optional(),
  rows: z
    .array(
      z.object({
        externalDate: z.coerce.date(),
        externalAmountCents: z.number().int().positive(),
        externalReference: z.string().optional(),
      }),
    )
    .min(1),
});
const confirmSchema = z.object({ paymentId: z.string().uuid(), note: z.string().optional() });

/** CDC Nextore §23 — rapprochement Europabank/Loyaltek, réservé au rôle manager (données financières sensibles). */
export function createNextoreReconciliationRouter(service: NextoreReconciliationService): Router {
  const router = Router();

  router.post("/admin/nextore/reconciliation/import", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(importSchema, req.body);
      const entries = await service.importBatch({ ...input, importedByUserId: req.authUser!.id });
      res.status(201).json({ data: entries });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/nextore/reconciliation/exceptions", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
    try {
      res.status(200).json({ data: await service.listExceptions() });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/nextore/reconciliation/unreconciled-card-payments", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
    try {
      res.status(200).json({ data: await service.listUnreconciledCardPayments() });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/nextore/reconciliation/entries/:entryId/confirm", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(confirmSchema, req.body);
      const entry = await service.confirmMatch({ entryId: req.params.entryId!, confirmedByUserId: req.authUser!.id, ...input });
      res.status(200).json({ data: entry });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
