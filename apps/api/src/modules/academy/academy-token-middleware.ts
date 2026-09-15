import type { NextFunction, Request, Response } from "express";
import { AppError, ErrorCodes } from "@ardenne/shared";
import type { AcademyInvitationService } from "./academy-invitation.service.js";

/**
 * Résout le token Academy transmis par l'élève (en-tête `X-Academy-Token`,
 * jamais en query string pour éviter qu'il finisse dans des logs d'accès —
 * même principe que le token de session V2). Bloque si absent/invalide :
 * contrairement à `attachAuthUser`, il n'existe pas de parcours élève sans
 * token (§8 — accès temporaire uniquement).
 */
export function requireAcademyStudentToken(invitations: AcademyInvitationService) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const rawToken = req.header("X-Academy-Token");
    if (!rawToken) {
      next(new AppError(ErrorCodes.UNAUTHENTICATED, "Lien Academy requis.", 401));
      return;
    }
    try {
      const student = await invitations.resolveInvitation(rawToken);
      req.academyStudent = { id: student.id, email: student.email };
      next();
    } catch (err) {
      next(err);
    }
  };
}
