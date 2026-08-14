import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { PaymentsRepository } from "./payments.repository.js";
import type { PaymentProvider } from "./types.js";

export interface RefundInput {
  /** `payments.id` interne — jamais l'ID Stripe directement depuis l'appelant. */
  paymentId: string;
  amountCents: number;
  reason?: string;
  createdBy?: string;
}

/**
 * CDC §30.1 — traçabilité complète (montant initial vs remboursé, source,
 * provider, référence, statut, cause, acteur, horodatage). Remboursement
 * total ou partiel supporté. Pas encore branché automatiquement sur
 * l'annulation (CDC §29.3) — capacité disponible dès ce lot, intégration
 * complète prévue avec le back-office (Lot 9).
 */
export class RefundService {
  constructor(
    private readonly paymentsRepo: PaymentsRepository,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async refund(input: RefundInput) {
    if (input.amountCents <= 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le montant à rembourser doit être positif.", 422);
    }

    const payment = await this.paymentsRepo.findPaymentById(input.paymentId);
    if (!payment) throw new AppError(ErrorCodes.NOT_FOUND, "Paiement introuvable.", 404);
    if (payment.status !== "SUCCEEDED") {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Seul un paiement capturé peut être remboursé.", 409);
    }
    if (input.amountCents > payment.amountCents) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le montant à rembourser dépasse le montant payé.", 422);
    }

    const refundRef = await this.paymentProvider.refund({
      providerPaymentId: payment.providerPaymentId,
      amountCents: input.amountCents,
      reason: input.reason,
    });

    const refund = await this.paymentsRepo.createRefund({
      payment: { connect: { id: payment.id } },
      providerRefundId: refundRef.providerRefundId,
      amountCents: input.amountCents,
      fundingSource: "EXTERNAL",
      status: refundRef.status === "succeeded" ? "SUCCEEDED" : refundRef.status === "pending" ? "PENDING" : "FAILED",
      reason: input.reason,
      createdBy: input.createdBy,
    });

    logger.info(
      { event: "RefundIssued", paymentId: payment.id, refundId: refund.id, amountCents: input.amountCents },
      "remboursement émis",
    );
    return refund;
  }
}
