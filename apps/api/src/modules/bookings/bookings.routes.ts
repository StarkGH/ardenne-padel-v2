import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth } from "../../http/auth-middleware.js";
import type { BookingsService } from "./bookings.service.js";

const createBookingSchema = z.object({
  courtId: z.string().uuid(),
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().positive(),
});

/** CDC §43 — endpoints Bookings. Toute écriture passe par un utilisateur authentifié. */
export function createBookingsRouter(service: BookingsService): Router {
  const router = Router();

  router.post("/bookings", requireAuth, async (req, res, next) => {
    try {
      const parsed = createBookingSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }

      const booking = await service.createBooking({
        organizerUserId: req.authUser!.id,
        courtId: parsed.data.courtId,
        startAt: parsed.data.startAt,
        durationMinutes: parsed.data.durationMinutes,
        source: "PWA",
      });
      res.status(201).json({ data: booking });
    } catch (err) {
      next(err);
    }
  });

  router.get("/bookings/:id", requireAuth, async (req, res, next) => {
    try {
      const booking = await service.getById(req.params.id!);
      if (booking.organizerUserId !== req.authUser!.id) {
        throw new AppError(ErrorCodes.FORBIDDEN, "Accès refusé.", 403);
      }
      res.status(200).json({ data: booking });
    } catch (err) {
      next(err);
    }
  });

  router.get("/me/bookings", requireAuth, async (req, res, next) => {
    try {
      const bookings = await service.listForOrganizer(req.authUser!.id);
      res.status(200).json({ data: bookings });
    } catch (err) {
      next(err);
    }
  });

  router.post("/bookings/:id/cancel", requireAuth, async (req, res, next) => {
    try {
      const booking = await service.cancelBooking(req.params.id!, req.authUser!.id);
      res.status(200).json({ data: booking });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
