import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import type { CourtsRepository } from "../courts/courts.repository.js";
import type { PricingService } from "./pricing.service.js";
import { NoTariffRuleFoundError } from "./tariff-resolver.js";

const querySchema = z.object({
  courtId: z.string().uuid(),
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().positive(),
});

export function createPricingRouter(service: PricingService, courtsRepo: CourtsRepository): Router {
  const router = Router();

  router.get("/pricing/quote", async (req, res, next) => {
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

      const quote = await service.quote(court, parsed.data.startAt, parsed.data.durationMinutes);
      res.status(200).json({ data: quote });
    } catch (err) {
      if (err instanceof NoTariffRuleFoundError) {
        next(new AppError("NO_TARIFF_RULE_FOUND", "Aucun tarif disponible pour ce créneau.", 404));
        return;
      }
      next(err);
    }
  });

  return router;
}
