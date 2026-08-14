import Stripe from "stripe";
import type { StripeClientPort, StripeEventLike, StripePaymentIntentLike } from "./stripe-client-port.js";

function toPaymentIntentLike(pi: Stripe.PaymentIntent): StripePaymentIntentLike {
  return {
    id: pi.id,
    status: pi.status,
    client_secret: pi.client_secret,
    latest_charge: pi.latest_charge as StripePaymentIntentLike["latest_charge"],
    payment_method_types: pi.payment_method_types,
  };
}

/**
 * Adaptateur explicite plutôt qu'un cast structurel du SDK Stripe complet
 * vers `StripeClientPort` — évite toute divergence de signature silencieuse
 * entre versions du SDK et notre port minimal (CDC §112 : réversibilité).
 */
export function createRealStripeClient(secretKey: string): StripeClientPort {
  const stripe = new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });

  return {
    customers: {
      async create(params) {
        const customer = await stripe.customers.create(params);
        return { id: customer.id };
      },
    },
    setupIntents: {
      async create(params) {
        const setupIntent = await stripe.setupIntents.create({ customer: params.customer });
        return { id: setupIntent.id, client_secret: setupIntent.client_secret };
      },
    },
    paymentIntents: {
      async create(params, options) {
        const pi = await stripe.paymentIntents.create(
          {
            amount: params.amount,
            currency: params.currency,
            customer: params.customer,
            payment_method: params.payment_method,
            confirm: params.confirm,
            capture_method: params.capture_method,
            off_session: params.off_session,
          },
          { idempotencyKey: options.idempotencyKey },
        );
        return toPaymentIntentLike(pi);
      },
      async capture(id) {
        const pi = await stripe.paymentIntents.capture(id);
        return toPaymentIntentLike(pi);
      },
      async cancel(id) {
        const pi = await stripe.paymentIntents.cancel(id);
        return toPaymentIntentLike(pi);
      },
      async retrieve(id) {
        const pi = await stripe.paymentIntents.retrieve(id);
        return toPaymentIntentLike(pi);
      },
    },
    refunds: {
      async create(params) {
        const refund = await stripe.refunds.create({
          payment_intent: params.payment_intent,
          amount: params.amount,
          reason: params.reason as Stripe.RefundCreateParams.Reason | undefined,
        });
        return { id: refund.id, status: refund.status };
      },
    },
    balanceTransactions: {
      async retrieve(id) {
        const tx = await stripe.balanceTransactions.retrieve(id);
        return { id: tx.id, fee: tx.fee, net: tx.net, currency: tx.currency };
      },
    },
    webhooks: {
      constructEvent(payload, signature, secret): StripeEventLike {
        const event = stripe.webhooks.constructEvent(payload, signature, secret);
        return { id: event.id, type: event.type, data: { object: event.data.object as unknown as Record<string, unknown> } };
      },
    },
    terminal: {
      async createConnectionToken(location) {
        const token = await stripe.terminal.connectionTokens.create(location ? { location } : undefined);
        return { secret: token.secret };
      },
      async createPaymentIntent(params) {
        // CDC §22.3 : ["card_present"] uniquement — jamais un moyen web
        // reclassé artificiellement en card_present (CDC §111).
        const pi = await stripe.paymentIntents.create({
          amount: params.amount,
          currency: params.currency,
          payment_method_types: ["card_present"],
          capture_method: params.captureMethod,
        });
        return toPaymentIntentLike(pi);
      },
      async capturePaymentIntent(id) {
        const pi = await stripe.paymentIntents.capture(id);
        return toPaymentIntentLike(pi);
      },
      async cancelPaymentIntent(id) {
        const pi = await stripe.paymentIntents.cancel(id);
        return toPaymentIntentLike(pi);
      },
    },
  };
}
