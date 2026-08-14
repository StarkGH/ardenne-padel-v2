import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth } from "../../http/auth-middleware.js";
import type { CheckoutService } from "./checkout.service.js";
import type { PaymentsRepository } from "./payments.repository.js";

const checkoutSchema = z.object({
  bookingId: z.string().uuid(),
  paymentMethodId: z.string().min(1),
});

/** CDC §43 — endpoints Payments. */
export function createPaymentsRouter(checkoutService: CheckoutService, paymentsRepo: PaymentsRepository): Router {
  const router = Router();

  router.post("/payments/checkout", requireAuth, async (req, res, next) => {
    try {
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }

      const result = await checkoutService.checkout({
        bookingId: parsed.data.bookingId,
        userId: req.authUser!.id,
        paymentMethodId: parsed.data.paymentMethodId,
      });
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.get("/payments/:id/status", requireAuth, async (req, res, next) => {
    try {
      const payment = await paymentsRepo.findPaymentByProviderPaymentId(req.params.id!);
      if (!payment || payment.userId !== req.authUser!.id) {
        throw new AppError(ErrorCodes.NOT_FOUND, "Paiement introuvable.", 404);
      }
      res.status(200).json({ data: { id: payment.id, status: payment.status } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
