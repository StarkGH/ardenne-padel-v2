/**
 * Interface CDC §21.1. Le domaine Booking ne dépend jamais directement du
 * SDK Stripe — tout passe par cette abstraction. Étendue au-delà de la
 * liste minimale du CDC avec `voidAuthorization` (nécessaire au cas
 * "collision Legacy après autorisation" du diagramme §27.1 — "Libérer/
 * annuler autorisation" — sans quoi l'orchestration ne pourrait pas être
 * fidèle au CDC).
 */

export type PaymentIntentStatus = "requires_action" | "requires_capture" | "succeeded" | "failed" | "canceled";

export interface PaymentCustomerRef {
  customerId: string;
}

export interface SetupRef {
  setupIntentId: string;
  clientSecret: string;
}

export interface PaymentRef {
  providerPaymentId: string;
  status: PaymentIntentStatus;
  clientSecret?: string;
  paymentMethodType?: string;
}

export interface RefundRef {
  providerRefundId: string;
  status: "succeeded" | "pending" | "failed";
}

export interface ProviderFeeRef {
  feeCents: number;
  netCents: number;
  currency: string;
  balanceTransactionId: string;
}

export interface CreateCustomerInput {
  userId: string;
  email: string;
}

export interface CreateSetupInput {
  customerId: string;
}

export interface CreatePaymentInput {
  customerId: string;
  amountCents: number;
  currency: string;
  paymentMethodId: string;
  /** Idempotence côté provider (CDC §47.1) — même clé -> même effet. */
  idempotencyKey: string;
}

export interface ConfirmOrCaptureInput {
  providerPaymentId: string;
}

export interface VoidAuthorizationInput {
  providerPaymentId: string;
}

export interface RefundInput {
  providerPaymentId: string;
  amountCents: number;
  reason?: string;
}

export interface ChargeSavedMethodInput {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
}

export interface GetActualProviderFeeInput {
  providerPaymentId: string;
}

export interface PaymentProvider {
  createCustomer(input: CreateCustomerInput): Promise<PaymentCustomerRef>;
  createSetup(input: CreateSetupInput): Promise<SetupRef>;
  createPayment(input: CreatePaymentInput): Promise<PaymentRef>;
  confirmOrCapture(input: ConfirmOrCaptureInput): Promise<PaymentRef>;
  voidAuthorization(input: VoidAuthorizationInput): Promise<void>;
  refund(input: RefundInput): Promise<RefundRef>;
  chargeSavedMethod(input: ChargeSavedMethodInput): Promise<PaymentRef>;
  getActualProviderFee(input: GetActualProviderFeeInput): Promise<ProviderFeeRef | null>;
}
