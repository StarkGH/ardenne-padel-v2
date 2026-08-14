import { Router } from "express";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth } from "../../http/auth-middleware.js";
import type { BookingsService } from "../bookings/bookings.service.js";
import type { AccessGrantService } from "./access-grant.service.js";

/** CDC §34 — l'organisateur consulte le(s) code(s) d'accès de sa réservation. */
export function createAccessRouter(bookingsService: BookingsService, accessGrantService: AccessGrantService): Router {
  const router = Router();

  router.get("/bookings/:id/access", requireAuth, async (req, res, next) => {
    try {
      const booking = await bookingsService.getById(req.params.id!);
      if (booking.organizerUserId !== req.authUser!.id) {
        throw new AppError(ErrorCodes.FORBIDDEN, "Accès refusé.", 403);
      }
      const grants = await accessGrantService.revealForBooking(booking.id);
      res.status(200).json({ data: grants });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
