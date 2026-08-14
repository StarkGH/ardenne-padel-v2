import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth } from "../../http/auth-middleware.js";
import type { CreditPackService } from "./credit-pack.service.js";
import type { CreditPacksRepository } from "./credit-packs.repository.js";

const purchaseSchema = z.object({ paymentMethodId: z.string().min(1) });

/** CDC §43 — endpoints Credit packs. */
export function createCreditPacksRouter(service: CreditPackService, repo: CreditPacksRepository): Router {
  const router = Router();

  router.get("/credit-packs", async (_req, res) => {
    const packs = await service.listActive();
    res.status(200).json({
      data: packs.map((p) => ({
        id: p.id,
        name: p.name,
        purchaseAmountCents: p.purchaseAmountCents,
        paidCreditsCents: p.paidCreditsCents,
        bonusCreditsCents: p.bonusCreditsCents,
        displayOrder: p.displayOrder,
      })),
    });
  });

  router.post("/credit-packs/:id/purchase", requireAuth, async (req, res, next) => {
    try {
      const parsed = purchaseSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const result = await service.purchase({
        userId: req.authUser!.id,
        creditPackId: req.params.id!,
        paymentMethodId: parsed.data.paymentMethodId,
      });
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.get("/credit-pack-purchases/:id", requireAuth, async (req, res, next) => {
    try {
      const purchase = await repo.findPurchaseById(req.params.id!);
      if (!purchase || purchase.userId !== req.authUser!.id) {
        throw new AppError(ErrorCodes.NOT_FOUND, "Achat introuvable.", 404);
      }
      res.status(200).json({ data: purchase });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
