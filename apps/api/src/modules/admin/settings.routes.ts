import { Router } from "express";
import type { AppConfig } from "@ardenne/config";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";

/**
 * CDC §55 écrans 17-18-25 — configuration paiement partagé, frais de
 * service split, paramètres généraux. La configuration est actuellement
 * 100% par variable d'environnement, validée une seule fois au démarrage
 * (`loadConfig`, `packages/config/src/env.ts`) — il n'existe aucun modèle
 * de configuration persisté ni de mécanisme de rechargement à chaud. Cet
 * endpoint expose donc un **instantané en lecture seule**, jamais un moyen
 * de modifier ces valeurs (qui reste, pour l'instant, une variable d'env +
 * redéploiement) — voir ADR-0025 pour la décision et la dette assumée.
 * Réservé SUPER_ADMIN : ce n'est pas une donnée opérationnelle quotidienne.
 * Ne renvoie jamais de secret (clés Stripe, session, identifiants Doinsport).
 */
export function createSettingsRouter(config: AppConfig): Router {
  const router = Router();

  router.get("/admin/settings", requireAuth, requireRole("SUPER_ADMIN"), (_req, res) => {
    res.status(200).json({
      data: {
        split: {
          paymentSplitEnabled: config.PAYMENT_SPLIT_ENABLED,
          serviceFeeEnabled: config.SPLIT_SERVICE_FEE_ENABLED,
          serviceFeeCents: config.SPLIT_SERVICE_FEE_CENTS,
          serviceFeeAllocation: config.SPLIT_SERVICE_FEE_ALLOCATION,
          invitationTtlHours: config.SPLIT_INVITATION_TTL_HOURS,
        },
        wallet: {
          enabled: config.WALLET_ENABLED,
          topupEnabled: config.WALLET_TOPUP_ENABLED,
          holdStaleHours: config.WALLET_HOLD_STALE_HOURS,
        },
        payments: {
          terminalEnabled: config.TERMINAL_ENABLED,
          qrHandoffEnabled: config.QR_HANDOFF_ENABLED,
          tapToPayEnabled: config.TAP_TO_PAY_ENABLED,
          offSessionGuaranteeEnabled: config.OFF_SESSION_GUARANTEE_ENABLED,
          walletGuaranteeEnabled: config.WALLET_GUARANTEE_ENABLED,
        },
        access: {
          v2AccessEnabled: config.V2_ACCESS_ENABLED,
          enabledBeforeMinutes: config.ACCESS_ENABLED_BEFORE_MINUTES,
          enabledAfterMinutes: config.ACCESS_ENABLED_AFTER_MINUTES,
        },
        kiosk: {
          sessionTtlMinutes: config.KIOSK_SESSION_TTL_MINUTES,
          offlineThresholdMinutes: config.KIOSK_OFFLINE_THRESHOLD_MINUTES,
        },
        legacy: {
          mode: config.LEGACY_MODE,
          syncEnabled: config.LEGACY_SYNC_ENABLED,
          writeEnabled: config.LEGACY_WRITE_ENABLED,
        },
        pilot: { pilotModeEnabled: config.PILOT_MODE_ENABLED },
      },
    });
  });

  return router;
}
