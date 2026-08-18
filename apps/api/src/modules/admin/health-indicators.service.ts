import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "@ardenne/config";

export interface HealthIndicators {
  lastLegacySyncAt: Date | null;
  legacySyncErrors: number;
  bookingsManualReview: number;
  paymentsFailed: number;
  walletHoldsStale: number;
  creditPacksPaidNotCredited: number;
  kioskDevicesOffline: number;
  terminalDevicesUnavailable: number;
  accessGrantsFailed: number;
  notificationsFailed: number;
}

/**
 * CDC §39.3 — indicateurs de santé back-office. "Frais provider anormaux"
 * n'est délibérément pas calculé ici : le CDC ne définit aucun seuil/
 * référentiel d'anomalie (contrairement aux autres indicateurs, tous des
 * comptages directs sur un statut existant) — fabriquer une règle métier
 * non spécifiée serait une hypothèse silencieuse (CDC §111, anti-pattern
 * explicitement proscrit). Documenté comme lacune ouverte dans PLAN_ACTION.md.
 */
export class HealthIndicatorsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  async compute(): Promise<HealthIndicators> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.config.WALLET_HOLD_STALE_HOURS * 3600_000);
    const kioskOfflineBefore = new Date(now.getTime() - this.config.KIOSK_OFFLINE_THRESHOLD_MINUTES * 60_000);

    const [
      lastMappingSync,
      lastSyncRun,
      legacySyncErrors,
      bookingsManualReview,
      paymentsFailed,
      walletHoldsStale,
      creditPacksPaidNotCredited,
      kioskDevicesOffline,
      terminalDevicesUnavailable,
      accessGrantsFailed,
      notificationsFailed,
    ] = await Promise.all([
      this.db.legacyBookingMapping.aggregate({ _max: { lastSyncAt: true } }),
      this.db.legacySyncRun.aggregate({ where: { status: "SUCCESS" }, _max: { finishedAt: true } }),
      this.db.legacyBookingMapping.count({
        where: { OR: [{ syncStatus: "FAILED" }, { syncStatus: "CONFIRMATION_UNKNOWN" }, { syncStatus: "CANCEL_PENDING", lastError: { not: null } }] },
      }),
      this.db.booking.count({ where: { status: "MANUAL_REVIEW" } }),
      this.db.payment.count({ where: { status: "FAILED" } }),
      this.db.walletHold.count({ where: { status: "ACTIVE", createdAt: { lt: staleBefore } } }),
      this.db.creditPackPurchase.count({ where: { status: "PAID" } }),
      this.db.kioskDevice.count({ where: { status: "ACTIVE", OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: kioskOfflineBefore } }] } }),
      this.db.terminalDevice.count({ where: { status: { not: "ACTIVE" } } }),
      this.db.accessGrant.count({ where: { status: "FAILED" } }),
      this.db.notificationOutbox.count({ where: { status: "FAILED" } }),
    ]);

    // "Dernière synchro Legacy" doit refléter les deux sens de la synchro
    // Dual Run : le scheduler périodique Doinsport → V2 (ADR-0035,
    // legacy_sync_runs — le plus actif des deux, toutes les 60s/300s) et
    // l'écriture V2 → Doinsport à la confirmation d'une réservation
    // (legacy_booking_mappings, CDC §27.1). Prendre le plus récent des deux
    // plutôt qu'une seule source, sous peine d'afficher "jamais" alors que
    // le scheduler tourne activement en tâche de fond.
    const mappingAt = lastMappingSync._max.lastSyncAt;
    const runAt = lastSyncRun._max.finishedAt;
    const lastLegacySyncAt = !mappingAt ? runAt : !runAt ? mappingAt : mappingAt > runAt ? mappingAt : runAt;

    return {
      lastLegacySyncAt,
      legacySyncErrors,
      bookingsManualReview,
      paymentsFailed,
      walletHoldsStale,
      creditPacksPaidNotCredited,
      kioskDevicesOffline,
      terminalDevicesUnavailable,
      accessGrantsFailed,
      notificationsFailed,
    };
  }
}
