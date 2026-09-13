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

const marginMinutesSchema = z.coerce.number().int().min(0).max(1440);

const createZoneSchema = z.object({
  key: z.string().min(1).max(100),
  type: z.enum(["DOOR", "LIGHT", "GENERIC"]),
  label: z.string().min(1).max(150),
  courtId: z.string().uuid().optional(),
  doorBeforeMinutes: marginMinutesSchema.optional(),
  doorAfterMinutes: marginMinutesSchema.optional(),
  lightBeforeMinutes: marginMinutesSchema.optional(),
  lightAfterMinutes: marginMinutesSchema.optional(),
});

const updateZoneMarginsSchema = z.object({
  doorBeforeMinutes: marginMinutesSchema.nullable().optional(),
  doorAfterMinutes: marginMinutesSchema.nullable().optional(),
  lightBeforeMinutes: marginMinutesSchema.nullable().optional(),
  lightAfterMinutes: marginMinutesSchema.nullable().optional(),
});

const commandTypeSchema = z.enum(["DOOR_OPEN", "DOOR_CLOSE", "LIGHT_ON", "LIGHT_OFF"]);

const testAccessCodeSchema = z.object({
  code: z.string().min(1).max(50),
});

const queueCommandSchema = z.object({
  type: commandTypeSchema,
});

const queueManualCommandSchema = z.object({
  type: commandTypeSchema,
});

const ackSchema = z.object({
  status: z.enum(["SUCCESS", "FAILED"]).default("SUCCESS"),
  error: z.string().max(200).optional(),
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
      res.status(200).json({
        data: zones.map((z) => ({
          id: z.id,
          key: z.key,
          type: z.type,
          label: z.label,
          courtId: z.courtId,
          courtName: z.court?.name ?? null,
          doorBeforeMinutes: z.doorBeforeMinutes,
          doorAfterMinutes: z.doorAfterMinutes,
          lightBeforeMinutes: z.lightBeforeMinutes,
          lightAfterMinutes: z.lightAfterMinutes,
        })),
      });
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

  router.patch("/admin/automation-zones/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const parsed = updateZoneMarginsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const zone = await service.updateZoneMargins(req.params.id!, parsed.data);
      res.status(200).json({
        data: { id: zone.id, doorBeforeMinutes: zone.doorBeforeMinutes, doorAfterMinutes: zone.doorAfterMinutes, lightBeforeMinutes: zone.lightBeforeMinutes, lightAfterMinutes: zone.lightAfterMinutes },
      });
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

  // --- Commandes manuelles (CDC_APV2_COMMANDES_MANUELLES_RASPBERRY_LOGO) ---
  // Sensibles (porte notamment) : ADMIN uniquement, jamais STAFF (§12).

  router.post("/admin/automation-devices/:id/commands", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const parsed = queueManualCommandSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const command = await service.queueManualCommand(req.params.id!, parsed.data.type, req.authUser!.id);
      await auditLog.record({ actorUserId: req.authUser!.id, action: "AUTOMATION_MANUAL_COMMAND_QUEUED", targetType: "AccessCommand", targetId: command.id });
      res.status(201).json({ data: command });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/automation-devices/:id/commands", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const commands = await service.listRecentCommandsForDevice(req.params.id!, limit);
      res.status(200).json({ data: commands });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/automation-commands/:id", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const command = await service.getCommand(req.params.id!);
      res.status(200).json({ data: command });
    } catch (err) {
      next(err);
    }
  });

  // Test admin d'un code (sans matériel) : rejoue la même logique de
  // validation que le Raspberry (mêmes sources/fenêtres), pour vérifier le
  // circuit code -> zone avant que le clavier physique soit câblé. Ne
  // révèle jamais de code existant, uniquement le résultat GRANTED/DENIED.
  router.post("/admin/automation/test-code", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const parsed = testAccessCodeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const result = await service.testAccessCode(parsed.data.code);
      res.status(200).json({ data: result });
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

  router.post("/devices/automation/commands/:id/ack", gated, requireAutomationDeviceAuth(service), async (req, res, next) => {
    try {
      const parsed = ackSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const result = parsed.data.status === "FAILED" ? (parsed.data.error ?? "FAILED") : "SUCCESS";
      await service.ackCommand(req.params.id!, req.automationDevice!.id, parsed.data.status, result);
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
