import { Router } from "express";
import { requireAuth } from "../../http/auth-middleware.js";
import type { WalletService } from "./wallet.service.js";
import type { WalletRepository } from "./wallet.repository.js";

/** CDC §43 — endpoints Wallet. */
export function createWalletRouter(walletService: WalletService, walletRepo: WalletRepository): Router {
  const router = Router();

  router.get("/me/wallet", requireAuth, async (req, res, next) => {
    try {
      const account = await walletService.ensureAccount(req.authUser!.id);
      const balance = await walletService.getBalance(account.id);
      res.status(200).json({ data: { walletAccountId: account.id, currency: account.currency, ...balance } });
    } catch (err) {
      next(err);
    }
  });

  router.get("/me/wallet/transactions", requireAuth, async (req, res, next) => {
    try {
      const account = await walletService.ensureAccount(req.authUser!.id);
      const transactions = await walletRepo.listTransactions(account.id);
      res.status(200).json({ data: transactions });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
