import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { ReportsService } from "./reports.service.js";

const revenueQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

/** CDC V-018 — chiffre d'affaires réservations pour la déclaration TVA (voir docs/tva.md). */
export function createReportsRouter(service: ReportsService): Router {
  const router = Router();

  router.get("/admin/reports/bookings-revenue", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const { from, to } = parseOrThrow(revenueQuerySchema, req.query);
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (fromDate > toDate) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "'from' doit précéder 'to'.", 422);
      }
      res.status(200).json({ data: await service.bookingsRevenue(fromDate, toDate) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
