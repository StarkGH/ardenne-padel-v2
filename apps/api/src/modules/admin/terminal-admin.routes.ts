import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { TerminalDeviceRepository } from "../payments/terminal-device.repository.js";
import type { AuditLogService } from "./audit-log.service.js";

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().max(100).optional(),
  // Identifiant du lecteur côté Stripe (ex. code d'enregistrement physique) —
  // jamais généré ici, ce dépôt n'orchestre pas de vrai appairage matériel
  // (CDC §22.4, en attente d'un compte Stripe + lecteur réels, ADR-0014).
  providerDeviceId: z.string().min(1).max(200),
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

/** CDC §55 écran 20 — inventaire des lecteurs Stripe Terminal du club. */
export function createTerminalAdminRouter(repo: TerminalDeviceRepository, auditLog: AuditLogService): Router {
  const router = Router();

  router.get("/admin/terminal-devices", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      res.status(200).json({ data: await repo.listActive() });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/terminal-devices", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(registerSchema, req.body);
      const device = await repo.create({
        name: input.name,
        location: input.location,
        providerDeviceId: input.providerDeviceId,
        capabilities: ["card_present"],
      });
      await auditLog.record({ actorUserId: req.authUser!.id, action: "TERMINAL_DEVICE_REGISTERED", targetType: "TerminalDevice", targetId: device.id, after: { name: device.name } });
      res.status(201).json({ data: device });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/terminal-devices/:id/revoke", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const device = await repo.revoke(req.params.id!);
      await auditLog.record({ actorUserId: req.authUser!.id, action: "TERMINAL_DEVICE_REVOKED", targetType: "TerminalDevice", targetId: device.id });
      res.status(200).json({ data: device });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
