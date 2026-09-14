import { Router } from "express";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { AfpadelSyncService } from "./afpadel-sync.service.js";
import type { AfpMemberRepository } from "./afp-member.repository.js";
import { buildAfpMembersCsv } from "./afp-member-csv.js";

/** Import de l'effectif du club depuis mon.afpadel.be (demande explicite 2026-09-14). */
export function createAfpadelRouter(syncService: AfpadelSyncService, repo: AfpMemberRepository): Router {
  const router = Router();

  router.get("/admin/afp-members", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      const members = await repo.listAll();
      res.status(200).json({ data: members, sync: syncService.getStatus() });
    } catch (err) {
      next(err);
    }
  });

  // Fire-and-forget : une synchro complète (liste + fiche de chaque joueur) prend facilement
  // plusieurs minutes (Playwright, ~120 pages) — bien trop long pour un cycle requête/réponse.
  router.post("/admin/afp-members/sync", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
    try {
      if (syncService.isSyncing()) {
        res.status(409).json({ error: { code: "AFPADEL_SYNC_IN_PROGRESS", message: "Une synchronisation AFPadel est déjà en cours." } });
        return;
      }
      void syncService.runInBackground();
      res.status(202).json({ data: { status: "started" } });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/afp-members/export", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      const members = await repo.listAll();
      const csv = buildAfpMembersCsv(members);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="afp-membres-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/afp-members/sync-status", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      res.status(200).json({ data: syncService.getStatus() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
