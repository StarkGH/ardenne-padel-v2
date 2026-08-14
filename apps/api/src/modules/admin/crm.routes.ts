import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { CrmService } from "./crm.service.js";

const searchSchema = z.object({ q: z.string().min(1) });
const addNoteSchema = z.object({ body: z.string().min(1).max(2000) });
const changeRoleSchema = z.object({ role: z.enum(["CUSTOMER", "STAFF", "ADMIN", "SUPER_ADMIN"]), reason: z.string().max(500).optional() });

/** CDC §40 — CRM client. Réservé au personnel du club (STAFF minimum). */
export function createCrmRouter(service: CrmService): Router {
  const router = Router();

  router.get("/admin/clients", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const parsed = searchSchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètre de recherche requis.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const results = await service.search(parsed.data.q);
      res.status(200).json({ data: results });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/clients/:userId", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const file = await service.getClientFile(req.params.userId!);
      res.status(200).json({ data: file });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/clients/:userId/notes", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const parsed = addNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const note = await service.addNote(req.params.userId!, req.authUser!.id, parsed.data.body);
      res.status(201).json({ data: note });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/clients/:userId/role", requireAuth, requireRole("SUPER_ADMIN"), async (req, res, next) => {
    try {
      const parsed = changeRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const result = await service.changeRole(req.authUser!.id, req.params.userId!, parsed.data.role, parsed.data.reason);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
