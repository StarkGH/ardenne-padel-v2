import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { MigrationInvitationService } from "./migration-invitation.service.js";

const validateSchema = z.object({ token: z.string().min(1) });
const confirmSchema = z.object({ token: z.string().min(1), password: z.string().min(1) });

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

/** CDC §7.3 — invitation admin (`/admin/legacy-clients/:id/invite`) et confirmation publique du flux de migration Doinsport → V2. */
export function createMigrationInvitationRouter(service: MigrationInvitationService): Router {
  const router = Router();

  router.post("/admin/legacy-clients/:id/invite", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.invite(req.authUser!.id, req.params.id!) });
    } catch (err) {
      next(err);
    }
  });

  /** Public — le jeton lui-même est la preuve, pas besoin d'être connecté (même modèle que `/verify-email`, `/email-change/confirm`). */
  router.post("/auth/migration-invite/validate", async (req, res, next) => {
    try {
      const { token } = parseOrThrow(validateSchema, req.body);
      res.status(200).json({ data: await service.validateToken(token) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/migration-invite/confirm", async (req, res, next) => {
    try {
      const { token, password } = parseOrThrow(confirmSchema, req.body);
      res.status(200).json({ data: await service.confirm(token, password) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
