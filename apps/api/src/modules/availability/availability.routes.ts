import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import type { CourtsRepository } from "../courts/courts.repository.js";
import type { AvailabilityService } from "./availability.service.js";
import { minutesToTimeString } from "./slot-calculator.js";

const querySchema = z.object({
  courtId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date attendue au format YYYY-MM-DD"),
});

/** CDC §10.2 : disponibilité consultable sans authentification. */
export function createAvailabilityRouter(service: AvailabilityService, courtsRepo: CourtsRepository): Router {
  const router = Router();

  router.get("/availability", async (req, res, next) => {
    try {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }

      const court = await courtsRepo.findById(parsed.data.courtId);
      if (!court || !court.active) {
        throw new AppError(ErrorCodes.NOT_FOUND, "Terrain introuvable.", 404);
      }

      const slots = await service.getAvailability(court, parsed.data.date);
      res.status(200).json({
        data: slots.map((s) => ({
          startTime: minutesToTimeString(s.startMinute),
          allowedDurationsMinutes: s.allowedDurationsMinutes,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
