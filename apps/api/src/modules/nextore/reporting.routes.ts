import { Router } from "express";
import { requireAuth, requireRole } from "../../http/auth-middleware.js";
import type { NextoreReportingService } from "./reporting.service.js";

function dateParams(req: { query: Record<string, unknown> }): { from?: string; to?: string } {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  return { from, to };
}

/** CDC Nextore §33 — reporting opérationnel, lecture seule, réservé au rôle manager (données financières agrégées). */
export function createNextoreReportingRouter(service: NextoreReportingService): Router {
  const router = Router();

  router.get("/admin/nextore/reports/sales-by-day", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { from, to } = dateParams(req);
      res.status(200).json({ data: await service.salesByDay(from, to) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/nextore/reports/sales-by-article", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { from, to } = dateParams(req);
      res.status(200).json({ data: await service.salesByArticle(from, to) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/nextore/reports/sales-by-category", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { from, to } = dateParams(req);
      res.status(200).json({ data: await service.salesByCategory(from, to) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/nextore/reports/sales-by-vat-rate", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { from, to } = dateParams(req);
      res.status(200).json({ data: await service.salesByVatRate(from, to) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/nextore/reports/payments-by-method", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { from, to } = dateParams(req);
      res.status(200).json({ data: await service.paymentsByMethod(from, to) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/nextore/reports/open-accounts", requireAuth, requireRole("STAFF"), async (_req, res, next) => {
    try {
      res.status(200).json({ data: await service.listOpenAccounts() });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/nextore/reports/stale-open-accounts", requireAuth, requireRole("STAFF"), async (req, res, next) => {
    try {
      const hours = req.query.hours ? Number(req.query.hours) : undefined;
      res.status(200).json({ data: await service.listStaleOpenAccounts(hours) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/nextore/reports/voided-lines", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { from, to } = dateParams(req);
      res.status(200).json({ data: await service.voidedLines(from, to) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/nextore/reports/reversed-payments", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { from, to } = dateParams(req);
      res.status(200).json({ data: await service.reversedPayments(from, to) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/nextore/reports/cash-variances", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { from, to } = dateParams(req);
      res.status(200).json({ data: await service.cashVariances(from, to) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
