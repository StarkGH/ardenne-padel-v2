import type { PaymentsRepository } from "../payments/payments.repository.js";
import type { RefundService } from "../payments/refund.service.js";
import type { AuditLogService } from "./audit-log.service.js";

/**
 * CDC §39.2 ("rembourser"), §58 ("remboursement") — enveloppe fine autour de
 * `RefundService` (Lot 4, jamais montée sur une route jusqu'ici) pour ajouter
 * la traçabilité admin sans dupliquer sa logique de remboursement.
 */
export class PaymentsAdminService {
  constructor(
    private readonly refundService: RefundService,
    private readonly auditLog: AuditLogService,
    private readonly paymentsRepo: PaymentsRepository,
  ) {}

  /** CDC §55 écrans 15-16 — paiements et coûts provider réels, tous clients confondus. */
  async list() {
    return this.paymentsRepo.listRecent();
  }

  async refund(actorUserId: string, paymentId: string, amountCents: number, reason?: string) {
    const refund = await this.refundService.refund({ paymentId, amountCents, reason, createdBy: actorUserId });
    await this.auditLog.record({
      actorUserId,
      action: "PAYMENT_REFUNDED",
      targetType: "Payment",
      targetId: paymentId,
      after: { refundId: refund.id, amountCents, reason },
      reason,
    });
    return refund;
  }
}
