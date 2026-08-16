import { Router } from "express";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { AuditLogService } from "./audit-log.service.js";

/** CDC §55 écran 24 — journal d'audit, lecture seule, jamais modifiable (append-only). */
export function createAuditLogRouter(service: AuditLogService): Router {
  const router = Router();

  router.get("/admin/audit-log", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const filter = {
        targetType: typeof req.query.targetType === "string" ? req.query.targetType : undefined,
        targetId: typeof req.query.targetId === "string" ? req.query.targetId : undefined,
        actorUserId: typeof req.query.actorUserId === "string" ? req.query.actorUserId : undefined,
      };
      res.status(200).json({ data: await service.list(filter) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
