import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { PaymentsAdminService } from "./payments-admin.service.js";

const refundSchema = z.object({
  amountCents: z.coerce.number().int().positive(),
  reason: z.string().max(500).optional(),
});

/** CDC §39.2, §58 — remboursement admin, réservé ADMIN (action financière irréversible côté club). */
export function createPaymentsAdminRouter(service: PaymentsAdminService): Router {
  const router = Router();

  router.post("/admin/payments/:id/refund", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const parsed = refundSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const refund = await service.refund(req.authUser!.id, req.params.id!, parsed.data.amountCents, parsed.data.reason);
      res.status(201).json({ data: refund });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
