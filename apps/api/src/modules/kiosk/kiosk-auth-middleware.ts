import type { NextFunction, Request, Response } from "express";
import { AppError, ErrorCodes } from "@ardenne/shared";
import type { KioskDeviceService } from "./kiosk-device.service.js";

/**
 * CDC §59.2 — endpoints kiosque strictement authentifiés par dispositif
 * enregistré, jamais par la simple session utilisateur (un kiosque n'est
 * pas un utilisateur — CDC §22.6 : "les clients à distance ne voient pas
 * les actions Terminal").
 */
export function requireKioskAuth(deviceService: KioskDeviceService) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const rawKey = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!rawKey) {
      next(new AppError(ErrorCodes.UNAUTHENTICATED, "Authentification kiosque requise.", 401));
      return;
    }
    try {
      const device = await deviceService.authenticate(rawKey);
      req.kioskDevice = { id: device.id, name: device.name };
      next();
    } catch (err) {
      next(err);
    }
  };
}
