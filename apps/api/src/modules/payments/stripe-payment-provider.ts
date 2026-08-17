import { AppError, ErrorCodes } from "@ardenne/shared";
import type { StripeClientPort, StripePaymentIntentLike } from "./stripe-client-port.js";
import type {
  ChargeSavedMethodInput,
  ConfirmOrCaptureInput,
  CreateCustomerInput,
  CreatePaymentInput,
  CreateSetupInput,
  DetachPaymentMethodInput,
  GetActualProviderFeeInput,
  ListPaymentMethodsInput,
  PaymentCustomerRef,
  PaymentIntentStatus,
  PaymentMethodRef,
  PaymentProvider,
  PaymentRef,
  ProviderFeeRef,
  RefundInput,
  RefundRef,
  SetupRef,
  VoidAuthorizationInput,
} from "./types.js";

function mapStatus(stripeStatus: string): PaymentIntentStatus {
  switch (stripeStatus) {
    case "requires_action":
    case "requires_confirmation":
    case "processing":
      return "requires_action";
    case "requires_capture":
      return "requires_capture";
    case "succeeded":
      return "succeeded";
    case "canceled":
      return "canceled";
    default:
      // requires_payment_method et tout statut inconnu : le paiement n'a pas abouti.
      return "failed";
  }
}

function toPaymentRef(pi: StripePaymentIntentLike): PaymentRef {
  return {
    providerPaymentId: pi.id,
    status: mapStatus(pi.status),
    clientSecret: pi.client_secret ?? undefined,
    paymentMethodType: pi.payment_method_types?.[0],
  };
}

function chargeIdFromLatestCharge(latestCharge: StripePaymentIntentLike["latest_charge"]): string | null {
  if (!latestCharge) return null;
  return typeof latestCharge === "string" ? latestCharge : latestCharge.id;
}

/**
 * Implémentation CDC §21.1. Ne stocke jamais de donnée carte (CDC §2.6) —
 * uniquement des références Stripe (`providerPaymentId`, etc.).
 */
export class StripePaymentProvider implements PaymentProvider {
  constructor(private readonly client: StripeClientPort) {}

  async createCustomer(input: CreateCustomerInput): Promise<PaymentCustomerRef> {
    const customer = await this.client.customers.create({
      email: input.email,
      metadata: { userId: input.userId },
    });
    return { customerId: customer.id };
  }

  async createSetup(input: CreateSetupInput): Promise<SetupRef> {
    const setupIntent = await this.client.setupIntents.create({ customer: input.customerId });
    if (!setupIntent.client_secret) {
      throw new Error("createSetup: Stripe n'a pas renvoyé de client_secret");
    }
    return { setupIntentId: setupIntent.id, clientSecret: setupIntent.client_secret };
  }

  /** Autorisation (capture manuelle) — CDC §27.1 : autoriser avant la création Legacy, capturer après. */
  async createPayment(input: CreatePaymentInput): Promise<PaymentRef> {
    const pi = await this.client.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        customer: input.customerId,
        payment_method: input.paymentMethodId,
        confirm: true,
        capture_method: "manual",
        // Confirmation synchrone sans return_url (pas de flux de redirection ici) —
        // exclut les moyens de paiement à redirection (Bancontact, iDEAL, ...)
        // même s'ils sont activés côté Dashboard (CDC §21.2).
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return toPaymentRef(pi);
  }

  async confirmOrCapture(input: ConfirmOrCaptureInput): Promise<PaymentRef> {
    const pi = await this.client.paymentIntents.capture(input.providerPaymentId);
    return toPaymentRef(pi);
  }

  /** Libère une autorisation non capturée (CDC §27.1 : "Libérer/annuler autorisation" en cas de collision). */
  async voidAuthorization(input: VoidAuthorizationInput): Promise<void> {
    await this.client.paymentIntents.cancel(input.providerPaymentId);
  }

  async refund(input: RefundInput): Promise<RefundRef> {
    const refund = await this.client.refunds.create({
      payment_intent: input.providerPaymentId,
      amount: input.amountCents,
      reason: input.reason,
    });
    return { providerRefundId: refund.id, status: mapRefundStatus(refund.status) };
  }

  /** Débit off-session d'un moyen enregistré (CDC §25.1 — garantie organisateur SPLIT, Lot 6). */
  async chargeSavedMethod(input: ChargeSavedMethodInput): Promise<PaymentRef> {
    const pi = await this.client.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        customer: input.customerId,
        payment_method: input.paymentMethodId,
        confirm: true,
        capture_method: "manual",
        off_session: true,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return toPaymentRef(pi);
  }

  /** CDC §30.3 — coût réel récupéré depuis la balance transaction, jamais un tarif hardcodé. */
  async getActualProviderFee(input: GetActualProviderFeeInput): Promise<ProviderFeeRef | null> {
    const pi = await this.client.paymentIntents.retrieve(input.providerPaymentId);
    const chargeId = chargeIdFromLatestCharge(pi.latest_charge);
    if (!chargeId || typeof pi.latest_charge === "string" || !pi.latest_charge?.balance_transaction) {
      return null; // pas encore disponible (asynchrone côté Stripe) — à réessayer plus tard.
    }
    const btId =
      typeof pi.latest_charge.balance_transaction === "string"
        ? pi.latest_charge.balance_transaction
        : pi.latest_charge.balance_transaction.id;
    const tx = await this.client.balanceTransactions.retrieve(btId);
    return { feeCents: tx.fee, netCents: tx.net, currency: tx.currency, balanceTransactionId: tx.id };
  }

  /** CDC §54 écran 19 — cartes attachées au customer. */
  async listPaymentMethods(input: ListPaymentMethodsInput): Promise<PaymentMethodRef[]> {
    const result = await this.client.paymentMethods.list({ customer: input.customerId, type: "card" });
    return result.data
      .filter((pm) => Boolean(pm.card))
      .map((pm) => ({
        id: pm.id,
        brand: pm.card!.brand,
        last4: pm.card!.last4,
        expMonth: pm.card!.exp_month,
        expYear: pm.card!.exp_year,
      }));
  }

  /** Stripe ne scope pas `detach()` par customer — on vérifie l'appartenance avant (CDC §111). */
  async detachPaymentMethod(input: DetachPaymentMethodInput): Promise<void> {
    const methods = await this.listPaymentMethods({ customerId: input.customerId });
    if (!methods.some((m) => m.id === input.paymentMethodId)) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Moyen de paiement introuvable.", 404);
    }
    await this.client.paymentMethods.detach(input.paymentMethodId);
  }
}

function mapRefundStatus(status: string | null): "succeeded" | "pending" | "failed" {
  if (status === "succeeded") return "succeeded";
  if (status === "pending") return "pending";
  return "failed";
}
