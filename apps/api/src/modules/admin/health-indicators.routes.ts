import { Router } from "express";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { HealthIndicatorsService } from "./health-indicators.service.js";

/** CDC §39.3 — indicateurs de santé back-office. */
export function createHealthIndicatorsRouter(service: HealthIndicatorsService): Router {
  const router = Router();

  router.get("/admin/health-indicators", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      res.status(200).json({ data: await service.compute() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
