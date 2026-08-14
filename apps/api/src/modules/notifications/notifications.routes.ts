import { Router } from "express";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { NotificationService } from "./notification.service.js";

/**
 * CDC §37.3 — tant qu'aucune infrastructure de job durable n'existe (voir
 * `notification.service.ts`), le traitement de l'outbox est déclenché
 * manuellement par un admin plutôt que par un scheduler.
 */
export function createNotificationsRouter(notificationService: NotificationService): Router {
  const router = Router();

  router.post("/admin/notifications/dispatch-due", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
    try {
      const result = await notificationService.dispatchDue();
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
