import type { NextFunction, Request, Response } from "express";
import { AppError, ErrorCodes } from "@ardenne/shared";
import type { AutomationService } from "./automation.service.js";

/**
 * Endpoints d'automatisation strictement authentifiés par dispositif
 * enregistré (Raspberry), jamais par session utilisateur — même logique que
 * `requireKioskAuth`.
 */
export function requireAutomationDeviceAuth(service: AutomationService) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const rawKey = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!rawKey) {
      next(new AppError(ErrorCodes.UNAUTHENTICATED, "Authentification dispositif requise.", 401));
      return;
    }
    try {
      const device = await service.authenticate(rawKey);
      req.automationDevice = { id: device.id, name: device.name };
      next();
    } catch (err) {
      next(err);
    }
  };
}
