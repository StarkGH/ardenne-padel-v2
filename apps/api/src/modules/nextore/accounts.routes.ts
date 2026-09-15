import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { NextoreAccountsService } from "./accounts.service.js";
import type { CrmRepository } from "../admin/crm.repository.js";

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

const openAccountSchema = z.object({ customerId: z.string().uuid().optional(), label: z.string().optional() });
const addParticipantSchema = z.object({ customerId: z.string().uuid().optional(), displayName: z.string().optional() });
const addLineSchema = z.object({ articleId: z.string().uuid(), participantId: z.string().uuid().optional(), quantity: z.number().positive() });
const voidLineSchema = z.object({ reason: z.string().min(1) });
const closeAccountSchema = z.object({ expectedVersion: z.number().int().nonnegative(), force: z.boolean().optional() });

/**
 * CDC Nextore §10/§11 — comptes ouverts, participants, lignes de vente.
 * `requireRole("STAFF")` sur l'usage courant (caisse), `ACC-010` (réouverture)
 * réservé côté Lot suivant (pas de réouverture dans ce lot).
 */
export function createNextoreAccountsRouter(service: NextoreAccountsService, crmRepo: CrmRepository): Router {
  const router = Router();

  router.get("/nextore/clients/search", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const query = typeof req.query.q === "string" ? req.query.q : "";
      res.status(200).json({ data: await crmRepo.searchUsers(query) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/nextore/accounts", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      res.status(200).json({ data: await service.listOpenAccounts() });
    } catch (err) {
      next(err);
    }
  });

  router.post("/nextore/accounts", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const input = parseOrThrow(openAccountSchema, req.body);
      res.status(201).json({ data: await service.openAccount({ ...input, openedByUserId: req.authUser!.id }) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/nextore/accounts/:id", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const account = await service.getAccount(req.params.id!);
      const dueCents = await service.getDueTotalCents(req.params.id!);
      res.status(200).json({ data: { ...account, dueCents } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/nextore/accounts/:id/participants", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const input = parseOrThrow(addParticipantSchema, req.body);
      res.status(201).json({ data: await service.addParticipant({ accountId: req.params.id!, ...input }) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/nextore/participants/:participantId/leave", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      res.status(200).json({ data: await service.removeParticipant(req.params.participantId!) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/nextore/accounts/:id/lines", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const input = parseOrThrow(addLineSchema, req.body);
      res.status(201).json({ data: await service.addLine({ accountId: req.params.id!, operatorUserId: req.authUser!.id, ...input }) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/nextore/lines/:lineId/void", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const { reason } = parseOrThrow(voidLineSchema, req.body);
      res.status(200).json({ data: await service.voidLine({ lineId: req.params.lineId!, reason, voidedByUserId: req.authUser!.id }) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/nextore/accounts/:id/close", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const input = parseOrThrow(closeAccountSchema, req.body);
      await service.closeAccount({ accountId: req.params.id!, closedByUserId: req.authUser!.id, ...input });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
