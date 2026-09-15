import { Router } from "express";
import { z } from "zod";
import { AppError, ErrorCodes } from "@ardenne/shared";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { NextoreCatalogService } from "./catalog.service.js";

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Paramètres invalides.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

const createCategorySchema = z.object({ label: z.string().min(1), parentId: z.string().uuid().optional(), displayOrder: z.number().int().optional() });
const activeSchema = z.object({ active: z.boolean() });
const createArticleSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  shortLabel: z.string().optional(),
  categoryId: z.string().uuid(),
  priceCents: z.number().int().nonnegative(),
  vatRatePercent: z.number().nonnegative(),
  photoUrl: z.string().url().optional(),
  displayOrder: z.number().int().optional(),
  internalProductRef: z.string().optional(),
});
const priceSchema = z.object({ priceCents: z.number().int().nonnegative() });

/** CDC Nextore §8 — catalogue POS, admin uniquement (RBAC-001/002). */
export function createNextoreCatalogRouter(service: NextoreCatalogService): Router {
  const router = Router();

  router.get("/nextore/categories", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      res.status(200).json({ data: await service.listCategories() });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/nextore/categories", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(createCategorySchema, req.body);
      res.status(201).json({ data: await service.createCategory(input) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/nextore/categories/:id/active", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { active } = parseOrThrow(activeSchema, req.body);
      res.status(200).json({ data: await service.setCategoryActive(req.params.id!, active) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/nextore/articles", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const query = typeof req.query.q === "string" ? req.query.q : undefined;
      const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : undefined;
      const active = req.query.active === "true" ? true : req.query.active === "false" ? false : undefined;
      res.status(200).json({ data: await service.searchArticles({ query, categoryId, active }) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/nextore/articles", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = parseOrThrow(createArticleSchema, req.body);
      res.status(201).json({ data: await service.createArticle(input) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/nextore/articles/:id/duplicate", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      res.status(201).json({ data: await service.duplicateArticle(req.params.id!) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/nextore/articles/:id/price", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { priceCents } = parseOrThrow(priceSchema, req.body);
      res.status(200).json({ data: await service.updatePrice(req.params.id!, priceCents) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/nextore/articles/:id/active", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { active } = parseOrThrow(activeSchema, req.body);
      res.status(200).json({ data: await service.setArticleActive(req.params.id!, active) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
