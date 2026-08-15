import type { NextFunction, Request, Response } from "express";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { roleAtLeast, type Role } from "@ardenne/domain";
import type { IdentityService } from "../modules/identity/identity.service.js";
import { readSessionToken } from "../modules/identity/session-cookie.js";

/**
 * Résout la session (si présente) et attache `req.authUser`. Ne bloque pas
 * la requête si absente : c'est `requireAuth` qui décide si l'endpoint
 * l'exige (CDC §18.2 — consultation possible sans compte).
 */
export function attachAuthUser(identityService: IdentityService) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = readSessionToken(req);
    if (!token) {
      next();
      return;
    }
    const user = await identityService.getUserFromSessionToken(token);
    if (user) {
      req.authUser = { id: user.id, email: user.email, role: user.role, status: user.status, pilotUser: user.pilotUser };
    }
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.authUser) {
    next(new AppError(ErrorCodes.UNAUTHENTICATED, "Authentification requise.", 401));
    return;
  }
  next();
}

export function requireRole(minimumRole: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      next(new AppError(ErrorCodes.UNAUTHENTICATED, "Authentification requise.", 401));
      return;
    }
    if (!roleAtLeast(req.authUser.role, minimumRole)) {
      next(new AppError(ErrorCodes.FORBIDDEN, "Accès refusé.", 403));
      return;
    }
    next();
  };
}
