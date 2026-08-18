import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import type { BookingsRepository } from "../bookings/bookings.repository.js";
import type { BookingsService } from "../bookings/bookings.service.js";
import type { CourtsRepository } from "../courts/courts.repository.js";
import type { IdentityRepository } from "../identity/identity.repository.js";
import type { LegacyBookingProvider } from "../legacy-doinsport/types.js";
import type { AccessGrantService } from "../access/access-grant.service.js";
import type { NotificationService } from "../notifications/notification.service.js";
import type { AuditLogService } from "./audit-log.service.js";

export interface AdminCreateBookingInput {
  organizerUserId: string;
  courtId: string;
  startAt: string;
  durationMinutes: number;
  paymentMode?: "FULL" | "SPLIT";
}

export interface AdminAddParticipantInput {
  displayName: string;
  userId?: string;
  legacyClientId?: string;
  invitedEmail?: string;
}

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
    private readonly bookingsService: BookingsService,
    private readonly identityRepo: IdentityRepository,
    private readonly courtsRepo: CourtsRepository,
  ) {}

  async listForDashboard(fromISO: string, toISO: string) {
    return this.repo.listInRange(new Date(fromISO), new Date(toISO));
  }

  /** CDC §55 écran 3 — occupations Doinsport-only pour le planning (voir ADR-0038 addendum). */
  async listLegacyForDashboard(fromISO: string, toISO: string) {
    const rows = await this.repo.listLegacyOccupationsInRange(new Date(fromISO), new Date(toISO));
    return rows.map((r) => ({
      id: r.id,
      courtId: r.courtId,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      clientName: r.legacyClient ? `${r.legacyClient.firstName} ${r.legacyClient.lastName}` : null,
      fullyPaid: r.fullyPaid,
      priceDueCents: r.priceDueCents,
      comment: r.comment,
      participants: r.participants.map((p) => ({ firstName: p.firstName, lastName: p.lastName, activeBookingsCount: p.activeBookingsCount })),
    }));
  }

  /** CDC §55 écran 3 — CA planning ventilé par canal (Stripe/wallet côté V2, Doinsport). */
  async revenueByChannel(fromISO: string, toISO: string) {
    const fromDate = new Date(fromISO);
    const toDate = new Date(toISO);
    const [channels, legacyRows] = await Promise.all([
      this.repo.sumRevenueByChannelInRange(fromDate, toDate),
      this.repo.listLegacyOccupationsInRange(fromDate, toDate),
    ]);
    const doinsportCents = legacyRows.reduce((sum, r) => sum + r.priceDueCents, 0);
    return { stripeCents: channels.stripeCents, walletCents: channels.walletCents, doinsportCents };
  }

  /** CDC §55 écran 22 — accès (codes provisionnés/échoués), jamais le chiffré lui-même. */
  async listAccessGrants(fromISO: string, toISO: string) {
    return this.repo.listAccessGrantsInRange(new Date(fromISO), new Date(toISO));
  }

  /** CDC §55 écran 4 — pas de garde organisateur/date ici, réservé STAFF+ (contrairement à `GET /bookings/:id` côté client). */
  async getById(bookingId: string) {
    const booking = await this.repo.findById(bookingId);
    if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);
    const organizer = await this.identityRepo.findUserById(booking.organizerUserId);
    return {
      ...booking,
      organizer: organizer ? { id: organizer.id, firstName: organizer.firstName, lastName: organizer.lastName, email: organizer.email } : null,
    };
  }

  /**
   * CDC §55 écran 5 — réservation téléphone/guichet pour un client existant.
   * Réutilise `BookingsService.createBooking` (même moteur que le client,
   * `source: "ADMIN"` déjà prévu au schéma) plutôt que de dupliquer la
   * logique de tarification/état — seule la provenance change.
   */
  async adminCreate(input: AdminCreateBookingInput, actorUserId: string) {
    const organizer = await this.identityRepo.findUserById(input.organizerUserId);
    if (!organizer) throw new AppError(ErrorCodes.NOT_FOUND, "Client introuvable.", 404);

    const booking = await this.bookingsService.createBooking({
      organizerUserId: organizer.id,
      courtId: input.courtId,
      startAt: input.startAt,
      durationMinutes: input.durationMinutes,
      paymentMode: input.paymentMode,
      source: "ADMIN",
      organizerIsPilotUser: organizer.pilotUser,
    });

    await this.auditLog.record({
      actorUserId,
      action: "BOOKING_ADMIN_CREATED",
      targetType: "Booking",
      targetId: booking.id,
      after: { courtId: booking.courtId, startAt: booking.startAt, organizerUserId: booking.organizerUserId },
    });

    return booking;
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

  /**
   * CDC §55 écran 5 — ajout d'un joueur lors d'une réservation créée au
   * téléphone/guichet. Réutilise les mêmes garde-fous que `BookingsService.
   * addParticipant` (statut modifiable, capacité du terrain) mais sans la
   * vérification "organisateur uniquement" : c'est précisément le point,
   * l'admin agit pour le compte du client — compensé par l'audit log
   * (CDC §58), comme le reste de ce service.
   */
  async adminAddParticipant(bookingId: string, actorUserId: string, input: AdminAddParticipantInput) {
    const booking = await this.repo.findById(bookingId);
    if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);
    if (!["DRAFT", "CHECKOUT_PENDING"].includes(booking.status)) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Les participants ne peuvent plus être modifiés pour cette réservation.", 409);
    }

    const court = await this.courtsRepo.findById(booking.courtId);
    const active = booking.participants.filter((p) => p.status !== "REMOVED");
    if (court && active.length + 1 >= court.capacity) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le terrain est déjà complet.", 422);
    }

    const participant = await this.repo.addParticipant({
      booking: { connect: { id: booking.id } },
      userId: input.userId,
      legacyClientId: input.legacyClientId,
      invitedEmail: input.invitedEmail,
      displayName: input.displayName,
      role: "PLAYER",
      status: "INVITED",
    });

    await this.auditLog.record({
      actorUserId,
      action: "BOOKING_ADMIN_PARTICIPANT_ADDED",
      targetType: "Booking",
      targetId: booking.id,
      after: { participantId: participant.id, displayName: participant.displayName },
    });

    return participant;
  }

  async adminRemoveParticipant(bookingId: string, actorUserId: string, participantId: string) {
    const booking = await this.repo.findById(bookingId);
    if (!booking) throw new AppError(ErrorCodes.NOT_FOUND, "Réservation introuvable.", 404);
    if (!["DRAFT", "CHECKOUT_PENDING"].includes(booking.status)) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Les participants ne peuvent plus être modifiés pour cette réservation.", 409);
    }
    const participant = booking.participants.find((p) => p.id === participantId);
    if (!participant) throw new AppError(ErrorCodes.NOT_FOUND, "Participant introuvable.", 404);

    await this.repo.removeParticipant(participantId);
    await this.auditLog.record({
      actorUserId,
      action: "BOOKING_ADMIN_PARTICIPANT_REMOVED",
      targetType: "Booking",
      targetId: booking.id,
      before: { participantId: participant.id, displayName: participant.displayName },
    });
  }
}
