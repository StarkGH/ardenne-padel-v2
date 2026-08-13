import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

/** CDC §88 — health checks internes, sans jamais exposer de secret. */
export function createHealthRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get("/health", async (_req, res) => {
    let database: "ok" | "error" = "ok";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "error";
    }

    const status = database === "ok" ? 200 : 503;
    res.status(status).json({ data: { status: database === "ok" ? "ok" : "degraded", database } });
  });

  return router;
}
