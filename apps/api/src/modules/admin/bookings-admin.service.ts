import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import type { BookingsRepository } from "../bookings/bookings.repository.js";
import type { LegacyBookingProvider } from "../legacy-doinsport/types.js";
import type { AccessGrantService } from "../access/access-grant.service.js";
import type { NotificationService } from "../notifications/notification.service.js";
import type { AuditLogService } from "./audit-log.service.js";

/**
 * CDC §39.1-§39.2 — vue planning multi-terrains et actions rapides admin
 * (annuler, forcer resync). Distinct de `BookingsService` : celui-ci sert le
 * client (organisateur uniquement, délai d'annulation opposable) ; celui-ci
 * sert le back-office (bypass délibéré de ces deux garde-fous, toujours
 * audité en contrepartie — CDC §58).
 */
export class BookingsAdminService {
  constructor(
    private readonly repo: BookingsRepository,
    private readonly legacyProvider: LegacyBookingProvider,
    private readonly config: AppConfig,
    private readonly accessGrantService: AccessGrantService,
    private readonly notificationService: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  async listForDashboard(fromISO: string, toISO: string) {
    return this.repo.listInRange(new Date(fromISO), new Date(toISO));
  }

  /** CDC §39.2 — annulation admin, sans les garde-fous côté client (organisateur/délai). */
  async adminCancel(bookingId: string, actorUserId: string, reason: string) {
    const booking = await this.repo.findById(bookingId);
    if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);
    if (booking.status !== "CONFIRMED") {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Seule une réservation confirmée peut être annulée.", 409);
    }

    const claimed = await this.repo.transitionStatus(booking.id, "CONFIRMED", "CANCEL_PENDING");
    if (!claimed) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Cette réservation est déjà en cours d'annulation.", 409);
    }

    if (booking.legacyBookingMapping?.legacyBookingId && this.config.LEGACY_WRITE_ENABLED) {
      try {
        await this.legacyProvider.cancelBooking(booking.legacyBookingMapping.legacyBookingId, { withRefund: false });
        await this.repo.updateLegacyMapping(booking.id, { syncStatus: "CANCELED" });
      } catch (err) {
        logger.error({ event: "LegacyCancelFailed", bookingId: booking.id, err }, "annulation Legacy en échec (admin)");
        await this.repo.updateLegacyMapping(booking.id, {
          syncStatus: "CANCEL_PENDING",
          lastError: err instanceof Error ? err.message : String(err),
        });
        await this.auditLog.record({ actorUserId, action: "BOOKING_ADMIN_CANCEL_LEGACY_FAILED", targetType: "Booking", targetId: booking.id, reason });
        return this.repo.findById(booking.id);
      }
    }

    const canceled = await this.repo.updateStatus(booking.id, "CANCELED", { canceledAt: new Date() });
    await this.auditLog.record({
      actorUserId,
      action: "BOOKING_ADMIN_CANCELED",
      targetType: "Booking",
      targetId: booking.id,
      before: { status: booking.status },
      after: { status: canceled.status },
      reason,
    });

    await this.accessGrantService.revokeForBooking(booking.id).catch((err) => {
      logger.error({ event: "AccessGrantAutomationFailed", bookingId: booking.id, err }, "automatisme d'accès en échec");
    });
    await this.notificationService
      .enqueue({
        template: "BOOKING_CANCELED",
        recipientUserId: canceled.organizerUserId,
        payload: { bookingId: canceled.id, startAt: canceled.startAt.toISOString(), canceledByAdmin: true, reason },
      })
      .catch((err) => logger.error({ event: "NotificationEnqueueFailed", bookingId: booking.id, err }, "échec d'enqueue notification"));

    return canceled;
  }

  /**
   * CDC §39.2 ("forcer resync") — marque une réservation pour reprise de
   * synchronisation. N'exécute pas immédiatement de nouvel appel Legacy : en
   * l'absence d'infrastructure de job (dette assumée depuis les Lots 4/7/8),
   * rejouer `createBookingInLegacy` aveuglément risquerait de créer un
   * doublon si l'état Legacy réel est en fait déjà confirmé (CDC §16.2).
   * Un vrai job de reprise (Lot ultérieur) consommera ce statut `PENDING`.
   */
  async forceResync(bookingId: string, actorUserId: string, reason?: string) {
    const booking = await this.repo.findById(bookingId);
    if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);
    if (!booking.legacyBookingMapping) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Cette réservation n'a pas de mapping Legacy.", 409);
    }
    const before = booking.legacyBookingMapping;
    const after = await this.repo.updateLegacyMapping(booking.id, { syncStatus: "PENDING", lastError: null });
    await this.auditLog.record({ actorUserId, action: "BOOKING_FORCE_RESYNC", targetType: "Booking", targetId: booking.id, before, after, reason });
    return after;
  }
}
