import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { WalletAdminService } from "./wallet-admin.service.js";

const amountReasonSchema = z.object({ amountCents: z.coerce.number().int().positive(), reason: z.string().min(1).max(500) });
const reasonSchema = z.object({ reason: z.string().max(500).optional() });

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

/** CDC §55 écrans 10-11-14 — wallets, crédit/débit avec motif, holds. */
export function createWalletAdminRouter(service: WalletAdminService): Router {
  const router = Router();

  router.get("/admin/wallets/:walletAccountId/holds", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.listHolds(req.params.walletAccountId!) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/wallets/:walletAccountId/transactions", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.listTransactions(req.params.walletAccountId!) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/wallets/:walletAccountId/credit", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { amountCents, reason } = parseOrThrow(amountReasonSchema, req.body);
      await service.credit(req.authUser!.id, req.params.walletAccountId!, amountCents, reason);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/wallets/:walletAccountId/debit", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { amountCents, reason } = parseOrThrow(amountReasonSchema, req.body);
      await service.debit(req.authUser!.id, req.params.walletAccountId!, amountCents, reason);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/wallet-holds/:id/release", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { reason } = parseOrThrow(reasonSchema, req.body ?? {});
      await service.releaseHold(req.authUser!.id, req.params.id!, reason);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/wallet-holds/:id/capture", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { reason } = parseOrThrow(reasonSchema, req.body ?? {});
      await service.captureHold(req.authUser!.id, req.params.id!, reason);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
