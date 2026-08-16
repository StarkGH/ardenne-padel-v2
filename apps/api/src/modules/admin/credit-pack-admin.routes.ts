import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { CreditPackAdminService } from "./credit-pack-admin.service.js";

const createSchema = z.object({
  name: z.string().min(1),
  purchaseAmountCents: z.coerce.number().int().positive(),
  paidCreditsCents: z.coerce.number().int().positive(),
  bonusCreditsCents: z.coerce.number().int().nonnegative().optional(),
  salesChannels: z.array(z.enum(["ONLINE", "KIOSK", "TERMINAL"])).min(1),
  validFrom: z.string().datetime({ offset: true }).optional(),
  validUntil: z.string().datetime({ offset: true }).optional(),
  displayOrder: z.coerce.number().int(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  purchaseAmountCents: z.coerce.number().int().positive().optional(),
  paidCreditsCents: z.coerce.number().int().positive().optional(),
  bonusCreditsCents: z.coerce.number().int().nonnegative().optional(),
  displayOrder: z.coerce.number().int().optional(),
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

export function createCreditPackAdminRouter(service: CreditPackAdminService): Router {
  const router = Router();

  router.get("/admin/credit-packs", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      res.status(200).json({ data: await service.listAll() });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/credit-pack-purchases", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      res.status(200).json({ data: await service.listPurchases() });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/credit-packs", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(createSchema, req.body);
      res.status(201).json({ data: await service.create(req.authUser!.id, input) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/credit-packs/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(updateSchema, req.body);
      res.status(200).json({ data: await service.update(req.authUser!.id, req.params.id!, input) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/credit-packs/:id/deactivate", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { reason } = parseOrThrow(deactivateSchema, req.body ?? {});
      res.status(200).json({ data: await service.deactivate(req.authUser!.id, req.params.id!, reason) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
