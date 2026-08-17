import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { LegacyMigrationAdminService } from "./legacy-migration-admin.service.js";

const legacyMigrationStatusEnum = z.enum(["LEGACY_ONLY", "INVITED", "MIGRATION_PENDING", "MIGRATED", "DISABLED", "MERGE_REQUIRED"]);
const listQuerySchema = z.object({ status: legacyMigrationStatusEnum.optional() });
const linkSchema = z.object({ userId: z.string().uuid() });
const disableSchema = z.object({ reason: z.string().max(500).optional() });

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

/** CDC §7.4-§7.5 — revue admin des fiches Shadow Client en conflit de déduplication. */
export function createLegacyMigrationAdminRouter(service: LegacyMigrationAdminService): Router {
  const router = Router();

  router.get("/admin/legacy-clients", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const { status } = parseOrThrow(listQuerySchema, req.query);
      res.status(200).json({ data: await service.list(status ?? "MERGE_REQUIRED") });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/legacy-clients/:id/link", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { userId } = parseOrThrow(linkSchema, req.body);
      res.status(200).json({ data: await service.linkToUser(req.authUser!.id, req.params.id!, userId) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/legacy-clients/:id/disable", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { reason } = parseOrThrow(disableSchema, req.body ?? {});
      res.status(200).json({ data: await service.disable(req.authUser!.id, req.params.id!, reason) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/legacy-clients/:id/reset", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.resetToPending(req.authUser!.id, req.params.id!) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
