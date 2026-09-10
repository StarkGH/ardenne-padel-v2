import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import { requireAutomationDeviceAuth } from "./automation-device-auth-middleware.js";
import type { AutomationService } from "./automation.service.js";
import type { AuditLogService } from "../admin/audit-log.service.js";

const registerDeviceSchema = z.object({
  name: z.string().min(1).max(100),
});

const createZoneSchema = z.object({
  key: z.string().min(1).max(100),
  type: z.enum(["DOOR", "LIGHT", "GENERIC"]),
  label: z.string().min(1).max(150),
  courtId: z.string().uuid().optional(),
});

const queueCommandSchema = z.object({
  type: z.enum(["OPEN_DOOR_PULSE", "LIGHT_OVERRIDE_ON", "LIGHT_OVERRIDE_OFF", "CLEAR_LIGHT_OVERRIDE"]),
});

const heartbeatSchema = z.object({
  revision: z.string().optional(),
  uptimeSeconds: z.number().nonnegative().optional(),
  nanoConnected: z.boolean().optional(),
  logoReachable: z.boolean().optional(),
  dbOk: z.boolean().optional(),
  pendingEvents: z.number().int().nonnegative().optional(),
  softwareVersion: z.string().optional(),
});

const eventsSchema = z.object({
  events: z
    .array(
      z.object({
        eventId: z.string().min(1),
        type: z.string().min(1),
        occurredAt: z.string().datetime({ offset: true }),
        payload: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(200),
});

function requireSyncEnabled(config: AppConfig) {
  return (_req: unknown, res: import("express").Response, next: import("express").NextFunction) => {
    if (!config.ACCESS_DEVICE_SYNC_ENABLED) {
      next(new AppError(ErrorCodes.FORBIDDEN, "Synchronisation d'automatisation désactivée.", 503));
      return;
    }
    next();
  };
}

/**
 * Phase 1 (CDC automatisation) : back-office "Accès / Automatisation"
 * (enregistrement/révocation de device, zones, commandes MVP) et endpoints
 * Raspberry (snapshot versionné, heartbeat, remontée d'événements
 * idempotente). Aucune action physique n'est déclenchée ici — le serveur ne
 * connaît jamais le mapping matériel (dossier technique §36/§37).
 */
export function createAutomationRouter(service: AutomationService, config: AppConfig, auditLog: AuditLogService): Router {
  const router = Router();
  const gated = requireSyncEnabled(config);

  // --- Back-office (ADMIN) ---

  router.post("/admin/automation-devices", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const parsed = registerDeviceSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const result = await service.registerDevice(parsed.data);
      // La clé brute n'est renvoyée qu'ici, une seule fois (CDC §57.1).
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/automation-devices", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
    try {
      const devices = await service.listDevices();
      res.status(200).json({
        data: devices.map((d) => ({
          id: d.id,
          name: d.name,
          lastSeenAt: d.lastSeenAt,
          lastSyncRevision: d.lastSyncRevision,
          lastHeartbeat: d.lastHeartbeat,
          offline: service.isOffline(d.lastSeenAt),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/automation-devices/:id/revoke", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      await service.revokeDevice(req.params.id!);
      await auditLog.record({ actorUserId: req.authUser!.id, action: "AUTOMATION_DEVICE_REVOKED", targetType: "AccessDevice", targetId: req.params.id! });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/automation-zones", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      const zones = await service.listZones();
      res.status(200).json({ data: zones.map((z) => ({ id: z.id, key: z.key, type: z.type, label: z.label, courtId: z.courtId, courtName: z.court?.name ?? null })) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/automation-zones", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const parsed = createZoneSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const zone = await service.createZone(parsed.data);
      res.status(201).json({ data: { id: zone.id, key: zone.key, type: zone.type, label: zone.label } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/automation-zones/:key/commands", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const parsed = queueCommandSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const command = await service.queueCommand(req.params.key!, parsed.data.type, req.authUser!.id);
      await auditLog.record({ actorUserId: req.authUser!.id, action: "AUTOMATION_COMMAND_QUEUED", targetType: "AccessCommand", targetId: command.id });
      res.status(201).json({ data: { id: command.id, status: command.status, expiresAt: command.expiresAt } });
    } catch (err) {
      next(err);
    }
  });

  // --- Dispositif Raspberry ---

  router.get("/devices/automation/snapshot", gated, requireAutomationDeviceAuth(service), async (req, res, next) => {
    try {
      const ifNoneMatch = req.headers["if-none-match"];
      const result = await service.buildSnapshot(req.automationDevice!.id, typeof ifNoneMatch === "string" ? ifNoneMatch : undefined);
      if (result.notModified) {
        res.setHeader("ETag", result.revision!);
        res.status(304).send();
        return;
      }
      res.setHeader("ETag", result.revision!);
      res.status(200).json({ data: result.body });
    } catch (err) {
      next(err);
    }
  });

  router.post("/devices/automation/heartbeat", gated, requireAutomationDeviceAuth(service), async (req, res, next) => {
    try {
      const parsed = heartbeatSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const { revision, ...rest } = parsed.data;
      await service.recordHeartbeat(req.automationDevice!.id, revision, rest);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post("/devices/automation/events", gated, requireAutomationDeviceAuth(service), async (req, res, next) => {
    try {
      const parsed = eventsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const result = await service.recordEvents(req.automationDevice!.id, parsed.data.events);
      res.status(202).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
