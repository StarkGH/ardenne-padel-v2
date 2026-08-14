import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import { requireKioskAuth } from "../kiosk/kiosk-auth-middleware.js";
import type { KioskDeviceService } from "../kiosk/kiosk-device.service.js";
import type { TerminalProvider } from "./terminal-provider.js";
import type { TerminalDeviceRepository } from "./terminal-device.repository.js";

const createPaymentIntentSchema = z.object({
  amountCents: z.coerce.number().int().positive(),
  currency: z.string().default("EUR"),
});

/**
 * CDC §43 — endpoints Terminal, réservés aux dispositifs kiosque enregistrés
 * (CDC §59.2). **Non reliés à une réservation ou un booking à ce stade** —
 * voir `terminal-provider.ts` : intégration complète différée jusqu'à
 * validation avec un vrai compte Stripe et un lecteur physique (V-014).
 */
export function createTerminalRouter(
  deviceService: KioskDeviceService,
  terminalProvider: TerminalProvider,
  terminalDeviceRepo: TerminalDeviceRepository,
  config: AppConfig,
): Router {
  const router = Router();

  router.post("/terminal/connection-token", requireKioskAuth(deviceService), async (_req, res, next) => {
    try {
      const token = await terminalProvider.createConnectionToken(config.STRIPE_TERMINAL_LOCATION_ID);
      res.status(200).json({ data: token });
    } catch (err) {
      next(err);
    }
  });

  router.post("/terminal/payment-intents", requireKioskAuth(deviceService), async (req, res, next) => {
    try {
      const parsed = createPaymentIntentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const intent = await terminalProvider.createPaymentIntent(parsed.data);
      res.status(201).json({ data: intent });
    } catch (err) {
      next(err);
    }
  });

  router.get("/terminal/devices", requireKioskAuth(deviceService), async (_req, res, next) => {
    try {
      const devices = await terminalDeviceRepo.listActive();
      res.status(200).json({ data: devices });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
