import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "@ardenne/config";
import type { HealthIndicatorsService } from "./health-indicators.service.js";

export interface AlertEntry {
  code: string;
  severity: "warning" | "critical";
  message: string;
  count: number;
}

/**
 * CDC §57.4 — conditions d'alerte. Contrairement à `HealthIndicatorsService`
 * (comptages d'état), ce service détecte des **incohérences** entre deux
 * tables qui ne devraient jamais diverger — la vraie valeur ajoutée d'une
 * alerte plutôt qu'un indicateur. Pas d'intégration de paging/notification
 * réelle (Slack, PagerDuty...) : aucun fournisseur n'est choisi pour
 * Ardenne Padel, documenté comme tel plutôt que fabriqué (même posture que
 * `LocalAccessProvider`, ADR-0016). Deux conditions du §57.4 ne sont pas
 * détectables avec les données actuelles et sont explicitement omises :
 * "wallet débité deux fois" (l'idempotence l'empêche structurellement — CDC
 * §47.2.bis — il n'y a donc rien à détecter après coup sans un signal
 * d'audit dédié qui n'existe pas) et "worker jobs indisponible" (aucun
 * worker n'existe encore, Lots 4/7/8/9).
 */
export class AlertsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly config: AppConfig,
    private readonly healthIndicators: HealthIndicatorsService,
  ) {}

  async compute(): Promise<AlertEntry[]> {
    const health = await this.healthIndicators.compute();
    const alerts: AlertEntry[] = [];

    if (health.bookingsManualReview > 0) {
      alerts.push({
        code: "BOOKINGS_MANUAL_REVIEW",
        severity: "critical",
        message: "Réservation(s) en attente de revue manuelle (état Legacy ambigu).",
        count: health.bookingsManualReview,
      });
    }

    const capturedWithoutConfirmed = await this.db.payment.count({
      where: {
        status: "SUCCEEDED",
        purpose: "BOOKING_FULL",
        booking: { status: { in: ["DRAFT", "CHECKOUT_PENDING", "PAYMENT_PENDING", "FAILED"] } },
      },
    });
    if (capturedWithoutConfirmed > 0) {
      alerts.push({
        code: "PAYMENT_CAPTURED_WITHOUT_CONFIRMED_BOOKING",
        severity: "critical",
        message: "Paiement capturé sur une réservation qui n'est pas CONFIRMED (CDC §57.4).",
        count: capturedWithoutConfirmed,
      });
    }

    const confirmedWithoutPayment = await this.db.booking.count({
      where: { status: "CONFIRMED", paymentMode: "FULL", paymentStatus: "NONE" },
    });
    if (confirmedWithoutPayment > 0) {
      alerts.push({
        code: "BOOKING_CONFIRMED_WITHOUT_PAYMENT",
        severity: "critical",
        message: "Réservation FULL confirmée sans paiement enregistré.",
        count: confirmedWithoutPayment,
      });
    }

    const canceledBookingIds = await this.db.booking.findMany({ where: { status: "CANCELED" }, select: { id: true } });
    const holdsNotReleased = await this.db.walletHold.count({
      where: { status: "ACTIVE", bookingId: { in: canceledBookingIds.map((b) => b.id) } },
    });
    if (holdsNotReleased > 0) {
      alerts.push({
        code: "WALLET_HOLD_NOT_RELEASED_AFTER_CANCELLATION",
        severity: "critical",
        message: "Hold wallet toujours actif alors que la réservation associée est annulée.",
        count: holdsNotReleased,
      });
    }

    if (health.creditPacksPaidNotCredited > 0) {
      alerts.push({
        code: "CREDIT_PACK_PAID_NOT_CREDITED",
        severity: "critical",
        message: "Achat de pack payé mais wallet non crédité.",
        count: health.creditPacksPaidNotCredited,
      });
    }

    const accessStartingSoonWithoutGrant = await this.db.booking.count({
      where: {
        status: "CONFIRMED",
        startAt: { gte: new Date(), lte: new Date(Date.now() + this.config.ACCESS_ENABLED_BEFORE_MINUTES * 2 * 60_000) },
        accessGrants: { none: {} },
      },
    });
    if (accessStartingSoonWithoutGrant > 0) {
      alerts.push({
        code: "ACCESS_NOT_PROVISIONED_NEAR_START",
        severity: "warning",
        message: "Réservation confirmée dont le créneau approche sans aucun code d'accès provisionné.",
        count: accessStartingSoonWithoutGrant,
      });
    }

    if (health.kioskDevicesOffline > 0) {
      alerts.push({
        code: "KIOSK_DEVICES_OFFLINE",
        severity: "warning",
        message: "Dispositif(s) kiosque hors ligne.",
        count: health.kioskDevicesOffline,
      });
    }
    if (health.terminalDevicesUnavailable > 0) {
      alerts.push({
        code: "TERMINAL_DEVICES_UNAVAILABLE",
        severity: "warning",
        message: "Lecteur(s) Terminal indisponible(s).",
        count: health.terminalDevicesUnavailable,
      });
    }
    if (health.notificationsFailed > 0) {
      alerts.push({
        code: "NOTIFICATIONS_FAILED",
        severity: "warning",
        message: "Notification(s) en échec définitif dans l'outbox.",
        count: health.notificationsFailed,
      });
    }

    return alerts;
  }
}
