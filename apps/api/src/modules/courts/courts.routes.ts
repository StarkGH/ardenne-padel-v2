import { Router } from "express";
import type { CourtsRepository } from "./courts.repository.js";

/** CDC §10.2 : consultation possible sans authentification. */
export function createCourtsRouter(repo: CourtsRepository): Router {
  const router = Router();

  router.get("/courts", async (_req, res) => {
    const courts = await repo.listActive();
    res.status(200).json({
      data: courts.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        courtType: c.courtType,
        capacity: c.capacity,
        displayOrder: c.displayOrder,
      })),
    });
  });

  return router;
}
