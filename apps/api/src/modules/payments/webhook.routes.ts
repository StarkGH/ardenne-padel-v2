import { Router, raw } from "express";
import { logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import type { StripeClientPort } from "./stripe-client-port.js";
import type { PaymentsRepository } from "./payments.repository.js";
import type { CheckoutService } from "./checkout.service.js";
import type { CreditPackService } from "../credit-packs/credit-pack.service.js";

/**
 * CDC §44 — endpoint dédié, signature vérifiée, dédup par `event_id`,
 * réponse rapide, jamais de donnée sensible dans les logs. Le corps doit
 * rester **brut** (`express.raw`) : Stripe exige les octets exacts pour
 * vérifier la signature — le JSON déjà parsé par le reste de l'app ne
 * conviendrait pas, d'où le montage de cette route avant `express.json()`.
 *
 * Traitement synchrone pour l'instant (pas de file de jobs avant le Lot 7/8,
 * voir schema.prisma) — acceptable tant que le volume reste faible, à
 * déplacer vers pg-boss dès son introduction pour respecter pleinement
 * "répondre rapidement, déléguer le traitement lourd à un job" (CDC §44).
 *
 * Un même PaymentIntent peut appartenir à une réservation (`CheckoutService`)
 * ou à un achat de pack de crédits (`CreditPackService`) — le dispatch se
 * fait sur `payments.purpose`, jamais en devinant depuis la forme de l'event.
 */
export function createWebhookRouter(
  stripeClient: StripeClientPort,
  config: AppConfig,
  paymentsRepo: PaymentsRepository,
  checkoutService: CheckoutService,
  creditPackService: CreditPackService,
): Router {
  const router = Router();

  router.post("/webhooks/stripe", raw({ type: "application/json" }), async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!config.STRIPE_WEBHOOK_SECRET || typeof signature !== "string") {
      res.status(400).send("missing signature or webhook secret");
      return;
    }

    let event;
    try {
      event = stripeClient.webhooks.constructEvent(req.body as Buffer, signature, config.STRIPE_WEBHOOK_SECRET);
    } catch {
      logger.warn({ event: "StripeWebhookSignatureInvalid" }, "signature webhook Stripe invalide");
      res.status(400).send(`invalid signature`);
      return;
    }

    if (await paymentsRepo.hasProcessedEvent(event.id)) {
      // CDC §44 : un webhook dupliqué ne doit jamais produire un second effet.
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    await paymentsRepo.recordEventSeen(event.id, event.type);

    try {
      const paymentIntent = event.data.object as { id: string };
      switch (event.type) {
        case "payment_intent.amount_capturable_updated": {
          const purpose = await paymentsRepo.findPurposeByProviderPaymentId(paymentIntent.id);
          if (purpose === "CREDIT_PACK_PURCHASE") {
            await creditPackService.continueAfterAuthorizationConfirmed(paymentIntent.id);
          } else {
            await checkoutService.continueAfterAuthorizationConfirmed(paymentIntent.id);
          }
          break;
        }
        case "payment_intent.payment_failed": {
          const purpose = await paymentsRepo.findPurposeByProviderPaymentId(paymentIntent.id);
          if (purpose !== "CREDIT_PACK_PURCHASE") {
            await checkoutService.handlePaymentFailedViaWebhook(paymentIntent.id);
          }
          // Les achats de pack échoués restent simplement PENDING/FAILED côté
          // Payment (déjà tracé) — aucune réservation à faire échouer en retour.
          break;
        }
        default:
          // Événement reçu mais non pertinent pour ce lot — accusé de
          // réception normal, pas une erreur (CDC §44 : répondre rapidement).
          break;
      }
      await paymentsRepo.markEventProcessed(event.id);
      res.status(200).json({ received: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await paymentsRepo.markEventFailed(event.id, message);
      logger.error({ event: "StripeWebhookProcessingFailed", stripeEventId: event.id, err }, "traitement webhook Stripe en échec");
      // 200 volontaire : Stripe réessaierait sinon indéfiniment un événement
      // dont l'échec est côté logique métier (déjà tracé), pas transitoire.
      res.status(200).json({ received: true, processingError: true });
    }
  });

  return router;
}
