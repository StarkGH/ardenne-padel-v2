/**
 * CDC §22.3-§22.4, §43 — abstraction Stripe Terminal, séparée de
 * `PaymentProvider` (qui couvre le canal ONLINE). **Non câblée dans
 * l'orchestration de checkout à ce stade** (ni `CheckoutService` ni
 * `SplitCheckoutService`) : sans compte Stripe ni lecteur physique pour
 * valider, brancher ces primitives dans un flux qui déplace de l'argent
 * réel serait irresponsable (CDC §112 — réduire le risque de perte
 * financière avant tout). Ces briques restent disponibles et testées avec
 * un faux provider, prêtes à être intégrées dès qu'une validation en
 * conditions réelles (V-014 du CDC) sera possible.
 */

export interface TerminalConnectionToken {
  secret: string;
}

export interface TerminalPaymentIntentRef {
  providerPaymentId: string;
  status: "requires_capture" | "succeeded" | "canceled" | "processing" | "failed";
  clientSecret?: string;
}

export interface CreateTerminalPaymentIntentInput {
  amountCents: number;
  currency: string;
}

export interface TerminalProvider {
  createConnectionToken(locationId?: string): Promise<TerminalConnectionToken>;
  createPaymentIntent(input: CreateTerminalPaymentIntentInput): Promise<TerminalPaymentIntentRef>;
  capturePaymentIntent(providerPaymentId: string): Promise<TerminalPaymentIntentRef>;
  cancelPaymentIntent(providerPaymentId: string): Promise<TerminalPaymentIntentRef>;
}
