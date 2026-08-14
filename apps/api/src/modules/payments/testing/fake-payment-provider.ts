import { randomUUID } from "node:crypto";
import type {
  ChargeSavedMethodInput,
  ConfirmOrCaptureInput,
  CreateCustomerInput,
  CreatePaymentInput,
  CreateSetupInput,
  GetActualProviderFeeInput,
  PaymentCustomerRef,
  PaymentIntentStatus,
  PaymentProvider,
  PaymentRef,
  ProviderFeeRef,
  RefundInput,
  RefundRef,
  SetupRef,
  VoidAuthorizationInput,
} from "../types.js";

/**
 * Double de test pour `PaymentProvider` — aucune clé Stripe requise. Reflète
 * le même contrat que `StripePaymentProvider` (mêmes statuts, même
 * comportement d'autorisation/capture manuelle) pour que les tests
 * d'orchestration restent représentatifs.
 */
export class FakePaymentProvider implements PaymentProvider {
  /** Statut renvoyé par `createPayment` — configurable par test. */
  authorizeResult: PaymentIntentStatus = "requires_capture";
  captureShouldFail = false;
  voidCalls: string[] = [];
  refundCalls: RefundInput[] = [];
  lastCreatePaymentInput: CreatePaymentInput | null = null;

  async createCustomer(input: CreateCustomerInput): Promise<PaymentCustomerRef> {
    return { customerId: `cus_fake_${input.userId}` };
  }

  async createSetup(_input: CreateSetupInput): Promise<SetupRef> {
    return { setupIntentId: `seti_fake_${randomUUID()}`, clientSecret: `seti_fake_secret_${randomUUID()}` };
  }

  async createPayment(input: CreatePaymentInput): Promise<PaymentRef> {
    this.lastCreatePaymentInput = input;
    const providerPaymentId = `pi_fake_${randomUUID()}`;
    return {
      providerPaymentId,
      status: this.authorizeResult,
      clientSecret: this.authorizeResult === "requires_action" ? `${providerPaymentId}_secret` : undefined,
      paymentMethodType: "card",
    };
  }

  async confirmOrCapture(input: ConfirmOrCaptureInput): Promise<PaymentRef> {
    return { providerPaymentId: input.providerPaymentId, status: this.captureShouldFail ? "failed" : "succeeded" };
  }

  async voidAuthorization(input: VoidAuthorizationInput): Promise<void> {
    this.voidCalls.push(input.providerPaymentId);
  }

  async refund(input: RefundInput): Promise<RefundRef> {
    this.refundCalls.push(input);
    return { providerRefundId: `re_fake_${randomUUID()}`, status: "succeeded" };
  }

  async chargeSavedMethod(_input: ChargeSavedMethodInput): Promise<PaymentRef> {
    return { providerPaymentId: `pi_fake_saved_${randomUUID()}`, status: "requires_capture", paymentMethodType: "card" };
  }

  async getActualProviderFee(_input: GetActualProviderFeeInput): Promise<ProviderFeeRef | null> {
    return { feeCents: 74, netCents: 4726, currency: "eur", balanceTransactionId: `txn_fake_${randomUUID()}` };
  }
}
