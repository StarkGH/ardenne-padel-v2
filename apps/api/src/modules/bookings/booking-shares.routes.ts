import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth } from "../../http/auth-middleware.js";
import type { BookingShareService } from "./booking-share.service.js";

const paySchema = z.object({
  fundingSource: z.enum(["WALLET", "EXTERNAL"]),
  paymentMethodId: z.string().optional(),
});

/** CDC §43 — endpoints Booking shares (paiement partagé, CDC §26). */
export function createBookingSharesRouter(service: BookingShareService): Router {
  const router = Router();

  /** CDC §54 écran 13 — l'organisateur consulte les parts de sa réservation SPLIT. */
  router.get("/bookings/:id/shares", requireAuth, async (req, res, next) => {
    try {
      const shares = await service.listSharesForOrganizer(req.params.id!, req.authUser!.id);
      res.status(200).json({
        data: shares.map((s) => ({
          id: s.id,
          participantUserId: s.participantUserId,
          invitedEmail: s.invitedEmail,
          baseAmountCents: s.baseAmountCents,
          serviceFeeAmountCents: s.serviceFeeAmountCents,
          totalAmountCents: s.totalAmountCents,
          status: s.status,
          paidAt: s.paidAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/booking-shares/:token", async (req, res, next) => {
    try {
      const share = await service.getShareByToken(req.params.token!);
      res.status(200).json({
        data: {
          id: share.id,
          bookingId: share.bookingId,
          baseAmountCents: share.baseAmountCents,
          serviceFeeAmountCents: share.serviceFeeAmountCents,
          totalAmountCents: share.totalAmountCents,
          status: share.status,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/booking-shares/:token/pay", requireAuth, async (req, res, next) => {
    try {
      const parsed = paySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const share = await service.payShare({
        rawToken: req.params.token!,
        payerUserId: req.authUser!.id,
        fundingSource: parsed.data.fundingSource,
        paymentMethodId: parsed.data.paymentMethodId,
      });
      res.status(200).json({ data: share });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
