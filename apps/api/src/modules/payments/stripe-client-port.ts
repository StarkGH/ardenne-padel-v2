/**
 * Sous-ensemble minimal du SDK Stripe réellement utilisé par
 * `StripePaymentProvider`. Isoler cette interface (plutôt qu'importer le
 * type `Stripe` complet partout) rend le provider testable avec un faux
 * client simple, sans dépendre du SDK ni de vraies clés API (CDC §112 —
 * testabilité).
 */

export interface StripeClientPort {
  customers: {
    create(params: { email: string; metadata?: Record<string, string> }): Promise<{ id: string }>;
  };
  setupIntents: {
    create(params: { customer: string }): Promise<{ id: string; client_secret: string | null }>;
  };
  paymentIntents: {
    create(params: {
      amount: number;
      currency: string;
      customer: string;
      payment_method: string;
      confirm: boolean;
      capture_method: "manual";
      off_session?: boolean;
    }, options: { idempotencyKey: string }): Promise<StripePaymentIntentLike>;
    capture(id: string): Promise<StripePaymentIntentLike>;
    cancel(id: string): Promise<StripePaymentIntentLike>;
    retrieve(id: string): Promise<StripePaymentIntentLike>;
  };
  refunds: {
    create(params: { payment_intent: string; amount: number; reason?: string }): Promise<{ id: string; status: string | null }>;
  };
  balanceTransactions: {
    retrieve(id: string): Promise<{ id: string; fee: number; net: number; currency: string }>;
  };
  webhooks: {
    constructEvent(payload: string | Buffer, signature: string, secret: string): StripeEventLike;
  };
  /** CDC §22.3-§22.4 — Stripe Terminal (card-present). */
  terminal: {
    createConnectionToken(location?: string): Promise<{ secret: string }>;
    createPaymentIntent(params: {
      amount: number;
      currency: string;
      captureMethod: "automatic" | "manual";
    }): Promise<StripePaymentIntentLike>;
    capturePaymentIntent(id: string): Promise<StripePaymentIntentLike>;
    cancelPaymentIntent(id: string): Promise<StripePaymentIntentLike>;
  };
}

export interface StripePaymentIntentLike {
  id: string;
  status: string;
  client_secret: string | null;
  latest_charge?: string | { id: string; balance_transaction?: string | { id: string } } | null;
  payment_method_types?: string[];
}

export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}
