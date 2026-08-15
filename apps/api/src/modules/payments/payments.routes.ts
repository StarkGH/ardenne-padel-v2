import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth } from "../../http/auth-middleware.js";
import type { BookingsRepository } from "../bookings/bookings.repository.js";
import type { CheckoutService } from "./checkout.service.js";
import type { SplitCheckoutService } from "./split-checkout.service.js";
import type { PaymentsRepository } from "./payments.repository.js";
import { ensureStripeCustomer } from "./ensure-stripe-customer.js";
import type { PaymentProvider } from "./types.js";

const checkoutSchema = z.object({
  bookingId: z.string().uuid(),
  paymentMethodId: z.string().min(1).optional(),
  applyWalletCents: z.coerce.number().int().nonnegative().optional(),
  // Présence de ce champ = checkout SPLIT (CDC §26) plutôt que FULL (§27.1).
  guaranteeType: z.enum(["CARD_OFF_SESSION", "WALLET_RESERVE"]).optional(),
});

/** CDC §43 — endpoints Payments. */
export function createPaymentsRouter(
  checkoutService: CheckoutService,
  splitCheckoutService: SplitCheckoutService,
  bookingsRepo: BookingsRepository,
  paymentsRepo: PaymentsRepository,
  paymentProvider: PaymentProvider,
): Router {
  const router = Router();

  router.post("/payments/checkout", requireAuth, async (req, res, next) => {
    try {
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }

      const booking = await bookingsRepo.findById(parsed.data.bookingId);
      if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);

      if (booking.paymentMode === "SPLIT") {
        if (!parsed.data.paymentMethodId || !parsed.data.guaranteeType) {
          throw new AppError(
            ErrorCodes.VALIDATION_FAILED,
            "paymentMethodId et guaranteeType sont requis pour un paiement partagé.",
            422,
          );
        }
        const result = await splitCheckoutService.checkout({
          bookingId: parsed.data.bookingId,
          userId: req.authUser!.id,
          paymentMethodId: parsed.data.paymentMethodId,
          guaranteeType: parsed.data.guaranteeType,
        });
        res.status(200).json({ data: result });
        return;
      }

      const result = await checkoutService.checkout({
        bookingId: parsed.data.bookingId,
        userId: req.authUser!.id,
        paymentMethodId: parsed.data.paymentMethodId,
        applyWalletCents: parsed.data.applyWalletCents,
      });
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  /** CDC §24.5, §54 écran 23 — aperçu des parts/frais avant validation, sans effet de bord. */
  router.get("/bookings/:id/split-preview", requireAuth, async (req, res, next) => {
    try {
      const preview = await splitCheckoutService.previewShares(req.params.id!, req.authUser!.id);
      res.status(200).json({ data: preview });
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

  /** CDC §25.1 — obtenir un moyen de paiement réutilisable (garantie CARD_OFF_SESSION). */
  router.post("/payments/setup", requireAuth, async (req, res, next) => {
    try {
      const customer = await ensureStripeCustomer(paymentsRepo, paymentProvider, req.authUser!.id);
      const setup = await paymentProvider.createSetup({ customerId: customer.customerId });
      res.status(200).json({ data: setup });
    } catch (err) {
      next(err);
    }
  });

  /**
   * CDC §54 écran 19 — moyens de paiement enregistrés. Pas de client Stripe
   * créé à la volée ici : un utilisateur qui n'a jamais rien payé/enregistré
   * n'a pas de `stripeCustomerId`, la liste est alors vide sans dépendre de
   * la configuration Stripe (contrairement à `/payments/setup`).
   */
  router.get("/me/payment-methods", requireAuth, async (req, res, next) => {
    try {
      const user = await paymentsRepo.findUserForPayment(req.authUser!.id);
      if (!user?.stripeCustomerId) {
        res.status(200).json({ data: [] });
        return;
      }
      const methods = await paymentProvider.listPaymentMethods({ customerId: user.stripeCustomerId });
      res.status(200).json({ data: methods });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/me/payment-methods/:id", requireAuth, async (req, res, next) => {
    try {
      const user = await paymentsRepo.findUserForPayment(req.authUser!.id);
      if (!user?.stripeCustomerId) {
        throw new AppError(ErrorCodes.NOT_FOUND, "Moyen de paiement introuvable.", 404);
      }
      await paymentProvider.detachPaymentMethod({ customerId: user.stripeCustomerId, paymentMethodId: req.params.id! });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
