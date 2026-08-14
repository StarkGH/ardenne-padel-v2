import type { PaymentTransactionStatus } from "@prisma/client";
import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import { ensureStripeCustomer } from "../payments/ensure-stripe-customer.js";
import type { PaymentsRepository } from "../payments/payments.repository.js";
import type { PaymentIntentStatus, PaymentProvider } from "../payments/types.js";
import type { WalletService } from "../wallet/wallet.service.js";
import type { CreditPacksRepository } from "./credit-packs.repository.js";

export interface PurchaseInput {
  userId: string;
  creditPackId: string;
  paymentMethodId: string;
}

export interface PurchaseResult {
  purchaseId: string;
  requiresAction: boolean;
  clientSecret?: string;
}

function toTransactionStatus(status: PaymentIntentStatus): PaymentTransactionStatus {
  switch (status) {
    case "requires_action":
      return "REQUIRES_ACTION";
    case "requires_capture":
      return "AUTHORIZED";
    case "succeeded":
      return "SUCCEEDED";
    case "canceled":
      return "CANCELED";
    default:
      return "FAILED";
  }
}

/**
 * CDC §28.2-§28.4 — achat d'un pack de crédits. Contrairement au checkout de
 * réservation (Lot 4), il n'y a pas d'étape Legacy à attendre : la capture
 * peut suivre l'autorisation immédiatement. Le seul risque à garder sous
 * contrôle est le double crédit sur retry/webhook dupliqué (CDC §111) —
 * garanti par une transition d'état atomique (`markCreditedIfPaid`), jamais
 * par une simple vérification en mémoire.
 */
export class CreditPackService {
  constructor(
    private readonly creditPacksRepo: CreditPacksRepository,
    private readonly paymentsRepo: PaymentsRepository,
    private readonly walletService: WalletService,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async listActive() {
    return this.creditPacksRepo.listActive(new Date());
  }

  async purchase(input: PurchaseInput): Promise<PurchaseResult> {
    const pack = await this.creditPacksRepo.findById(input.creditPackId);
    if (!pack || !pack.active) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Pack de crédits introuvable.", 404);
    }

    const purchase = await this.creditPacksRepo.createPurchase({
      creditPack: { connect: { id: pack.id } },
      user: { connect: { id: input.userId } },
      purchaseAmountCents: pack.purchaseAmountCents,
      paidCreditsCents: pack.paidCreditsCents,
      bonusCreditsCents: pack.bonusCreditsCents,
      status: "PENDING",
    });

    const customer = await ensureStripeCustomer(this.paymentsRepo, this.paymentProvider, input.userId);

    const paymentRef = await this.paymentProvider.createPayment({
      customerId: customer.customerId,
      amountCents: pack.purchaseAmountCents,
      currency: "EUR",
      paymentMethodId: input.paymentMethodId,
      idempotencyKey: `creditpack:${purchase.id}`,
    });

    const payment = await this.paymentsRepo.createPayment({
      user: { connect: { id: input.userId } },
      provider: "stripe",
      providerPaymentId: paymentRef.providerPaymentId,
      paymentChannel: "ONLINE",
      paymentMethodType: paymentRef.paymentMethodType,
      amountCents: pack.purchaseAmountCents,
      currency: "EUR",
      status: toTransactionStatus(paymentRef.status),
      purpose: "CREDIT_PACK_PURCHASE",
    });
    await this.creditPacksRepo.updatePurchase(purchase.id, { payment: { connect: { id: payment.id } } });

    if (paymentRef.status === "failed") {
      await this.creditPacksRepo.updatePurchase(purchase.id, { status: "FAILED" });
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le paiement n'a pas pu être validé.", 402);
    }

    if (paymentRef.status === "requires_action") {
      return { purchaseId: purchase.id, requiresAction: true, clientSecret: paymentRef.clientSecret };
    }

    await this.captureAndCredit(purchase.id, payment.id, payment.providerPaymentId);
    return { purchaseId: purchase.id, requiresAction: false };
  }

  /** Point d'entrée webhook (`payment_intent.amount_capturable_updated`) après 3D Secure. */
  async continueAfterAuthorizationConfirmed(providerPaymentId: string): Promise<void> {
    const payment = await this.paymentsRepo.findPaymentByProviderPaymentId(providerPaymentId);
    if (!payment) return;
    const purchase = await this.creditPacksRepo.findPurchaseByPaymentId(payment.id);
    if (!purchase || purchase.status !== "PENDING") return; // idempotence (CDC §44)

    await this.paymentsRepo.updatePaymentStatus(payment.id, { status: "AUTHORIZED" });
    await this.captureAndCredit(purchase.id, payment.id, providerPaymentId);
  }

  private async captureAndCredit(purchaseId: string, paymentId: string, providerPaymentId: string): Promise<void> {
    const captured = await this.paymentProvider.confirmOrCapture({ providerPaymentId });
    if (captured.status !== "succeeded") {
      await this.paymentsRepo.updatePaymentStatus(paymentId, { status: "FAILED" });
      await this.creditPacksRepo.updatePurchase(purchaseId, { status: "FAILED" });
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le paiement n'a pas pu être capturé.", 502);
    }

    await this.paymentsRepo.updatePaymentStatus(paymentId, { status: "SUCCEEDED" });
    await this.creditPacksRepo.updatePurchase(purchaseId, { status: "PAID" });

    // Garde-fou d'idempotence : seule la transition atomique PAID->CREDITED
    // décide si le wallet doit être crédité (jamais un simple if en mémoire).
    const shouldCredit = await this.creditPacksRepo.markCreditedIfPaid(purchaseId);
    if (!shouldCredit) {
      logger.info({ event: "CreditPackAlreadyCredited", purchaseId }, "pack déjà crédité, appel ignoré (idempotence)");
      return;
    }

    const purchase = await this.creditPacksRepo.findPurchaseById(purchaseId);
    if (!purchase) throw new Error(`captureAndCredit: achat ${purchaseId} introuvable après capture`);

    const wallet = await this.walletService.ensureAccount(purchase.userId);
    await this.walletService.creditFromPackPurchase({
      walletAccountId: wallet.id,
      creditPackPurchaseId: purchase.id,
      paidCreditsCents: purchase.paidCreditsCents,
      bonusCreditsCents: purchase.bonusCreditsCents,
    });
  }
}
