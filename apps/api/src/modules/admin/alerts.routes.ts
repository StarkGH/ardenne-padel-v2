import { Router } from "express";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { AlertsService } from "./alerts.service.js";

/** CDC §57.4 — conditions d'alerte actives. */
export function createAlertsRouter(service: AlertsService): Router {
  const router = Router();

  router.get("/admin/alerts", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      res.status(200).json({ data: await service.compute() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
