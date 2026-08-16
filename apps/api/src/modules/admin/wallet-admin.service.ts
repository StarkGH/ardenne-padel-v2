import type { WalletService } from "../wallet/wallet.service.js";
import type { WalletRepository } from "../wallet/wallet.repository.js";
import type { AuditLogService } from "./audit-log.service.js";

/**
 * CDC §55 écrans 10-11-14 — wallets, crédit/débit avec motif, holds. Fine
 * enveloppe autour de `WalletService` (le moteur de ledger, Lot 5) pour
 * ajouter la traçabilité admin, même schéma que `PaymentsAdminService`
 * autour de `RefundService`.
 */
export class WalletAdminService {
  constructor(
    private readonly walletService: WalletService,
    private readonly walletRepo: WalletRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  async listHolds(walletAccountId: string) {
    return this.walletRepo.listHoldsForWallet(walletAccountId);
  }

  async listTransactions(walletAccountId: string) {
    return this.walletRepo.listTransactions(walletAccountId);
  }

  async credit(actorUserId: string, walletAccountId: string, amountCents: number, reason: string) {
    await this.walletService.creditAdmin({ walletAccountId, amountCents, createdBy: actorUserId, reason });
    await this.auditLog.record({
      actorUserId,
      action: "WALLET_ADMIN_CREDIT",
      targetType: "WalletAccount",
      targetId: walletAccountId,
      after: { amountCents, reason },
      reason,
    });
  }

  async debit(actorUserId: string, walletAccountId: string, amountCents: number, reason: string) {
    await this.walletService.debitAdmin({ walletAccountId, amountCents, createdBy: actorUserId, reason });
    await this.auditLog.record({
      actorUserId,
      action: "WALLET_ADMIN_DEBIT",
      targetType: "WalletAccount",
      targetId: walletAccountId,
      after: { amountCents, reason },
      reason,
    });
  }

  async releaseHold(actorUserId: string, holdId: string, reason?: string) {
    await this.walletService.releaseHold(holdId);
    await this.auditLog.record({ actorUserId, action: "WALLET_HOLD_RELEASED_ADMIN", targetType: "WalletHold", targetId: holdId, reason });
  }

  async captureHold(actorUserId: string, holdId: string, reason?: string) {
    await this.walletService.captureHold(holdId);
    await this.auditLog.record({ actorUserId, action: "WALLET_HOLD_CAPTURED_ADMIN", targetType: "WalletHold", targetId: holdId, reason });
  }
}
