import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import { requireKioskAuth } from "./kiosk-auth-middleware.js";
import type { KioskDeviceService } from "./kiosk-device.service.js";
import type { KioskCheckoutSessionService } from "./kiosk-checkout-session.service.js";
import type { AuditLogService } from "../admin/audit-log.service.js";

const createSessionSchema = z.object({
  courtId: z.string().uuid(),
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().positive(),
  paymentMode: z.enum(["FULL", "SPLIT"]).optional(),
});

const registerDeviceSchema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().max(100).optional(),
  capabilities: z.array(z.enum(["TERMINAL", "QR_HANDOFF"])).min(1),
});

/**
 * CDC §43 — endpoints Kiosque/QR. `POST` et `:id/status`/`:id/cancel` sont
 * réservés au dispositif (CDC §59.2) ; `GET .../:token` reste accessible
 * sans authentification (consultation, CDC §18.2) mais réclame
 * automatiquement la session — donc crée la réservation — dès qu'un
 * utilisateur authentifié la consulte : reprend "exactement le checkout en
 * cours" (CDC §22.2) sans exposer d'endpoint de réclamation séparé, non
 * listé au CDC §43.
 */
export function createKioskRouter(deviceService: KioskDeviceService, sessionService: KioskCheckoutSessionService, auditLog: AuditLogService): Router {
  const router = Router();

  /** Préfigure le Lot 9 (back-office) : réservé ADMIN, hors namespace kiosque proprement dit. */
  router.post("/admin/kiosk-devices", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const parsed = registerDeviceSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const result = await deviceService.register(parsed.data);
      // La clé brute n'est renvoyée qu'ici, une seule fois (CDC §57.1).
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/kiosk-devices", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
    try {
      const devices = await deviceService.listActive();
      res.status(200).json({ data: devices.map((d) => ({ id: d.id, name: d.name, location: d.location, capabilities: d.capabilities, lastSeenAt: d.lastSeenAt })) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/kiosk-devices/:id/revoke", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      await deviceService.revoke(req.params.id!);
      await auditLog.record({ actorUserId: req.authUser!.id, action: "KIOSK_DEVICE_REVOKED", targetType: "KioskDevice", targetId: req.params.id! });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post("/kiosk/checkout-sessions", requireKioskAuth(deviceService), async (req, res, next) => {
    try {
      const parsed = createSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const session = await sessionService.createSession({
        kioskDeviceId: req.kioskDevice!.id,
        ...parsed.data,
      });
      res.status(201).json({ data: session });
    } catch (err) {
      next(err);
    }
  });

  router.get("/kiosk/checkout-sessions/:token", async (req, res, next) => {
    try {
      const session = await sessionService.getByToken(req.params.token!);

      if (req.authUser && session.status === "PENDING") {
        const booking = await sessionService.claim(req.params.token!, req.authUser.id, req.authUser.pilotUser);
        res.status(200).json({ data: { claimed: true, booking } });
        return;
      }

      res.status(200).json({
        data: {
          claimed: false,
          courtId: session.courtId,
          startAt: session.startAt,
          durationMinutes: session.durationMinutes,
          paymentMode: session.paymentMode,
          status: session.status,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/kiosk/checkout-sessions/:id/status", requireKioskAuth(deviceService), async (req, res, next) => {
    try {
      const status = await sessionService.getStatusForKiosk(req.params.id!, req.kioskDevice!.id);
      res.status(200).json({ data: status });
    } catch (err) {
      next(err);
    }
  });

  router.post("/kiosk/checkout-sessions/:id/cancel", requireKioskAuth(deviceService), async (req, res, next) => {
    try {
      await sessionService.cancel(req.params.id!, req.kioskDevice!.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
