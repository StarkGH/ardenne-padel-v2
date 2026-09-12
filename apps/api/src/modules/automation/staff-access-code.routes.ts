import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { StaffAccessCodeService } from "./staff-access-code.service.js";
import type { AuditLogService } from "../admin/audit-log.service.js";

const createStaffCodeSchema = z.object({
  employeeName: z.string().min(1).max(150),
  zoneIds: z.array(z.string().uuid()).min(1),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

/**
 * Codes maîtres employés — jamais liés à une réservation (module `access`),
 * cycle de vie propre. Sensibles (accès permanent, zone par zone) : ADMIN
 * uniquement pour créer/révoquer, comme les commandes manuelles porte/lumière.
 */
export function createStaffAccessCodeRouter(service: StaffAccessCodeService, auditLog: AuditLogService): Router {
  const router = Router();

  router.post("/admin/staff-access-codes", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const parsed = createStaffCodeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const created = await service.create({
        employeeName: parsed.data.employeeName,
        zoneIds: parsed.data.zoneIds,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
        createdBy: req.authUser!.id,
      });
      await auditLog.record({ actorUserId: req.authUser!.id, action: "STAFF_ACCESS_CODE_CREATED", targetType: "StaffAccessCode", targetId: created.id });
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/staff-access-codes", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
    try {
      const codes = await service.listActive();
      res.status(200).json({ data: codes });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/staff-access-codes/:id/revoke", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      await service.revoke(req.params.id!);
      await auditLog.record({ actorUserId: req.authUser!.id, action: "STAFF_ACCESS_CODE_REVOKED", targetType: "StaffAccessCode", targetId: req.params.id! });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
