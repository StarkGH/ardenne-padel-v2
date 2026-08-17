import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "@ardenne/config";
import { logger } from "@ardenne/shared";
import type { LegacyDoinsportRepository } from "./legacy-doinsport.repository.js";
import type { LegacyBookingProvider } from "./types.js";
import { importClients, importBookings } from "./legacy-import.service.js";

/**
 * CDC §15.3 — deux niveaux de synchro Doinsport → V2 tournant en continu,
 * réutilisant la même logique que l'import manuel (`legacy-import.service.ts`) :
 *
 * - **Sync fréquente** (`LEGACY_SYNC_INTERVAL_SECONDS`, défaut 60 s) :
 *   réservations proches uniquement (fenêtre glissante courte) — c'est ce
 *   qui alimente l'anti-collision Dual Run (ADR-0033) en quasi temps réel.
 * - **Réconciliation** (`LEGACY_RECONCILIATION_INTERVAL_SECONDS`, défaut
 *   300 s) : re-fetch complet des clients + réservations futures sur une
 *   fenêtre large, pour rattraper tout ce que la sync fréquente aurait pu
 *   manquer (redémarrage, panne temporaire Doinsport, etc.).
 *
 * Fenêtres volontairement différentes de l'import initial (`import-legacy.ts`,
 * qui remonte 2 ans en arrière) : une fois l'historique importé une fois,
 * seul l'avenir importe pour l'anti-collision — la réconciliation n'a pas
 * besoin de rebalayer le passé à chaque cycle.
 */
export class LegacySyncScheduler {
  private fastTimer: ReturnType<typeof setInterval> | null = null;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private fastRunning = false;
  private reconciliationRunning = false;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaClient,
    private readonly adapter: LegacyBookingProvider,
    private readonly repo: LegacyDoinsportRepository,
  ) {}

  start(): void {
    if (!this.config.LEGACY_SYNC_ENABLED) {
      logger.info({ event: "LegacySyncSchedulerDisabled" }, "scheduler de synchro Doinsport désactivé (LEGACY_SYNC_ENABLED=false)");
      return;
    }
    if (!this.config.DOINSPORT_CLUB_LOGIN || !this.config.DOINSPORT_CLUB_PASSWORD || !this.config.DOINSPORT_CLUB_ID) {
      logger.warn(
        { event: "LegacySyncSchedulerMissingCredentials" },
        "scheduler de synchro Doinsport non démarré — identifiants Doinsport manquants en configuration",
      );
      return;
    }

    this.fastTimer = setInterval(() => void this.runFastSync(), this.config.LEGACY_SYNC_INTERVAL_SECONDS * 1000);
    this.reconciliationTimer = setInterval(() => void this.runReconciliation(), this.config.LEGACY_RECONCILIATION_INTERVAL_SECONDS * 1000);
    logger.info(
      {
        event: "LegacySyncSchedulerStarted",
        fastIntervalSeconds: this.config.LEGACY_SYNC_INTERVAL_SECONDS,
        reconciliationIntervalSeconds: this.config.LEGACY_RECONCILIATION_INTERVAL_SECONDS,
      },
      "scheduler de synchro Doinsport démarré",
    );
  }

  stop(): void {
    if (this.fastTimer) clearInterval(this.fastTimer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.fastTimer = null;
    this.reconciliationTimer = null;
  }

  /** Réservations proches uniquement — jamais les clients (coût réseau minimal, cadence courte). */
  async runFastSync(): Promise<void> {
    if (this.fastRunning) {
      logger.warn({ event: "LegacySyncSkippedOverlap", kind: "BOOKINGS_FAST" }, "sync fréquente ignorée — la précédente est toujours en cours");
      return;
    }
    this.fastRunning = true;
    try {
      const fromISO = new Date(Date.now() - 3600_000).toISOString();
      const toISO = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
      await importBookings(this.adapter, this.repo, this.prisma, fromISO, toISO);
    } catch (err) {
      logger.error({ event: "LegacyFastSyncFailed", err }, "échec de la synchro fréquente Doinsport");
    } finally {
      this.fastRunning = false;
    }
  }

  /** Clients + réservations futures sur une fenêtre large — rattrape ce que la sync fréquente aurait manqué. */
  async runReconciliation(): Promise<void> {
    if (this.reconciliationRunning) {
      logger.warn({ event: "LegacySyncSkippedOverlap", kind: "RECONCILIATION" }, "réconciliation ignorée — la précédente est toujours en cours");
      return;
    }
    this.reconciliationRunning = true;
    try {
      await importClients(this.adapter, this.prisma);
      const fromISO = new Date(Date.now() - 24 * 3600_000).toISOString();
      const toISO = new Date(Date.now() + 365 * 24 * 3600_000).toISOString();
      await importBookings(this.adapter, this.repo, this.prisma, fromISO, toISO);
    } catch (err) {
      logger.error({ event: "LegacyReconciliationFailed", err }, "échec de la réconciliation Doinsport");
    } finally {
      this.reconciliationRunning = false;
    }
  }
}
