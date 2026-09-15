import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { NextorePaymentsService } from "./payments.service.js";

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

const recordPaymentSchema = z.object({
  participantId: z.string().uuid().optional(),
  amountCents: z.number().int().positive(),
  method: z.enum(["CASH", "CARD", "WALLET_CREDIT"]),
  externalReference: z.string().optional(),
  idempotencyKey: z.string().min(1),
});
const reversePaymentSchema = z.object({ reason: z.string().min(1) });

/** CDC Nextore §12/§26 — paiements et contrepassations. */
export function createNextorePaymentsRouter(service: NextorePaymentsService): Router {
  const router = Router();

  router.get("/nextore/accounts/:id/payments", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.listForAccount(req.params.id!) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/nextore/accounts/:id/payments", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const input = parseOrThrow(recordPaymentSchema, req.body);
      const payment = await service.recordPayment({ accountId: req.params.id!, recordedByUserId: req.authUser!.id, ...input });
      res.status(201).json({ data: payment });
    } catch (err) {
      next(err);
    }
  });

  router.post("/nextore/payments/:paymentId/reverse", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const { reason } = parseOrThrow(reversePaymentSchema, req.body);
      const reversed = await service.reversePayment({ paymentId: req.params.paymentId!, reason, reversedByUserId: req.authUser!.id });
      res.status(200).json({ data: reversed });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
