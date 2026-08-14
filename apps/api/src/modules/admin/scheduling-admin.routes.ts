import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { SchedulingAdminService } from "./scheduling-admin.service.js";

const tariffRuleSchema = z.object({
  name: z.string().min(1),
  courtId: z.string().uuid().optional(),
  courtType: z.enum(["SIMPLE", "DOUBLE"]).optional(),
  validFrom: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: z.string(),
  endTime: z.string(),
  durationMinutes: z.coerce.number().int().positive(),
  priceTotalCents: z.coerce.number().int().nonnegative().optional(),
  pricePerParticipantCents: z.coerce.number().int().nonnegative().optional(),
  referenceCapacity: z.coerce.number().int().positive(),
  priority: z.coerce.number().int(),
  tags: z.array(z.string()).optional(),
});

const openingRuleSchema = z.object({
  courtId: z.string().uuid().optional(),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  startTime: z.string(),
  endTime: z.string(),
  validFrom: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }).optional(),
});

const courtClosureSchema = z.object({
  courtId: z.string().uuid(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  reason: z.string().max(500).optional(),
  closureType: z.enum(["MAINTENANCE", "EVENT", "ADMIN_BLOCK"]),
});

const deactivateSchema = z.object({ reason: z.string().max(500).optional() });

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

/** CDC §39.2, §58 — configuration tarifs/horaires/fermetures, réservée ADMIN. */
export function createSchedulingAdminRouter(service: SchedulingAdminService): Router {
  const router = Router();

  router.get("/admin/tariff-rules", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.listTariffRules(req.query.courtId as string | undefined) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/tariff-rules", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(tariffRuleSchema, req.body);
      res.status(201).json({ data: await service.createTariffRule(req.authUser!.id, input) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/tariff-rules/:id/deactivate", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { reason } = parseOrThrow(deactivateSchema, req.body ?? {});
      res.status(200).json({ data: await service.deactivateTariffRule(req.authUser!.id, req.params.id!, reason) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/opening-rules", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.listOpeningRules(req.query.courtId as string | undefined) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/opening-rules", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(openingRuleSchema, req.body);
      res.status(201).json({ data: await service.createOpeningRule(req.authUser!.id, input) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/opening-rules/:id/deactivate", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { reason } = parseOrThrow(deactivateSchema, req.body ?? {});
      res.status(200).json({ data: await service.deactivateOpeningRule(req.authUser!.id, req.params.id!, reason) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/court-closures", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.listCourtClosures(req.query.courtId as string | undefined) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/court-closures", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(courtClosureSchema, req.body);
      res.status(201).json({ data: await service.createCourtClosure(req.authUser!.id, input) });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/admin/court-closures/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      await service.deleteCourtClosure(req.authUser!.id, req.params.id!, req.query.reason as string | undefined);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
