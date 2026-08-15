import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import type { IdentityService } from "./identity.service.js";
import { requireAuth } from "../../http/auth-middleware.js";

const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(30).optional(),
});

function parseOrThrow<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return result.data;
}

/**
 * CDC §54 écran 18 — profil. Namespace `/me/*` (comme wallet/bookings/
 * payment-methods) plutôt que `/auth/*` : ce ne sont pas des actions
 * d'authentification, seulement une lecture/mise à jour du compte courant.
 */
export function createProfileRouter(identityService: IdentityService): Router {
  const router = Router();

  router.get("/me/profile", requireAuth, async (req, res, next) => {
    try {
      const profile = await identityService.getProfile(req.authUser!.id);
      res.status(200).json({ data: profile });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/me/profile", requireAuth, async (req, res, next) => {
    try {
      const input = parseOrThrow(updateProfileSchema, req.body);
      const profile = await identityService.updateProfile(req.authUser!.id, input);
      res.status(200).json({ data: profile });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
