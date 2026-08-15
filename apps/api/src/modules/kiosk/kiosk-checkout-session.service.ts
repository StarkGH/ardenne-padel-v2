import { AppError, ErrorCodes } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import { generateOpaqueToken, hashToken } from "../identity/tokens.js";
import type { BookingsService } from "../bookings/bookings.service.js";
import type { BookingsRepository } from "../bookings/bookings.repository.js";
import type { KioskCheckoutSessionRepository } from "./kiosk-checkout-session.repository.js";

export interface CreateKioskSessionInput {
  kioskDeviceId: string;
  courtId: string;
  startAt: string;
  durationMinutes: number;
  paymentMode?: "FULL" | "SPLIT";
}

/**
 * CDC §22.2 — QR handoff. La session ne porte qu'un créneau choisi, jamais
 * de donnée bancaire ni de secret durable (CDC §22.2 : "Le QR ne doit jamais
 * embarquer de donnée bancaire ou secret durable" — ici, un token opaque
 * pointant vers une session serveur, rien d'autre). La réservation réelle et
 * son paiement passent ensuite par les endpoints standards (`POST /bookings`,
 * `POST /payments/checkout`) : cette classe ne fait que transporter le
 * créneau jusqu'à ce qu'un utilisateur authentifié le réclame.
 */
export class KioskCheckoutSessionService {
  constructor(
    private readonly repo: KioskCheckoutSessionRepository,
    private readonly bookingsService: BookingsService,
    private readonly bookingsRepo: BookingsRepository,
    private readonly config: AppConfig,
  ) {}

  async createSession(input: CreateKioskSessionInput): Promise<{ id: string; token: string; expiresAt: Date }> {
    const { raw, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.KIOSK_SESSION_TTL_MINUTES * 60_000);

    const session = await this.repo.create({
      kioskDevice: { connect: { id: input.kioskDeviceId } },
      courtId: input.courtId,
      startAt: new Date(input.startAt),
      durationMinutes: input.durationMinutes,
      paymentMode: input.paymentMode ?? "FULL",
      tokenHash: hash,
      expiresAt,
    });

    return { id: session.id, token: raw, expiresAt };
  }

  async getByToken(rawToken: string) {
    const session = await this.repo.findByTokenHash(hashToken(rawToken));
    if (!session) throw new AppError(ErrorCodes.NOT_FOUND, "Session introuvable.", 404);
    if (session.status === "PENDING" && session.expiresAt < new Date()) {
      throw new AppError("KIOSK_SESSION_EXPIRED", "Cette session a expiré. Merci de recommencer depuis la tablette.", 410);
    }
    return session;
  }

  /** CDC §22.2 étape 5 : le smartphone reprend exactement le checkout en cours. */
  async claim(rawToken: string, userId: string, organizerIsPilotUser = false) {
    const session = await this.getByToken(rawToken);
    if (session.status !== "PENDING") {
      throw new AppError("KIOSK_SESSION_ALREADY_CLAIMED", "Cette session a déjà été utilisée.", 409);
    }

    const claimed = await this.repo.claimIfPending(session.id, userId);
    if (!claimed) {
      // Concurrence : quelqu'un d'autre a scanné/réclamé entre-temps.
      throw new AppError("KIOSK_SESSION_ALREADY_CLAIMED", "Cette session a déjà été utilisée.", 409);
    }

    const booking = await this.bookingsService.createBooking({
      organizerUserId: userId,
      courtId: session.courtId,
      startAt: session.startAt.toISOString(),
      durationMinutes: session.durationMinutes,
      paymentMode: session.paymentMode,
      source: "PWA",
      organizerIsPilotUser,
    });
    await this.repo.setBookingId(session.id, booking.id);

    return booking;
  }

  /** Statut consulté par la tablette (CDC §54.1 : "état temps réel du paiement"). */
  async getStatusForKiosk(sessionId: string, kioskDeviceId: string) {
    const session = await this.repo.findById(sessionId);
    if (!session || session.kioskDeviceId !== kioskDeviceId) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Session introuvable.", 404);
    }

    if (!session.bookingId) {
      return { status: session.status, bookingStatus: null };
    }
    const booking = await this.bookingsRepo.findById(session.bookingId);
    return { status: session.status, bookingId: session.bookingId, bookingStatus: booking?.status ?? null };
  }

  async cancel(sessionId: string, kioskDeviceId: string): Promise<void> {
    const session = await this.repo.findById(sessionId);
    if (!session || session.kioskDeviceId !== kioskDeviceId) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Session introuvable.", 404);
    }
    await this.repo.cancelIfPending(sessionId);
  }
}
