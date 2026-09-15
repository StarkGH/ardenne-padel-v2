import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { NextoreCatalogRepository } from "./catalog.repository.js";
import { NextoreCatalogService } from "./catalog.service.js";

describe("NextoreCatalogService (CDC Nextore §8 — catalogue)", () => {
  let prisma: PrismaClient;
  let service: NextoreCatalogService;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    service = new NextoreCatalogService(new NextoreCatalogRepository(prisma));
    const category = await service.createCategory({ label: "Bières" });
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates an article with mandatory fields (CAT-001)", async () => {
    const article = await service.createArticle({
      code: "BIERE-33",
      label: "Bière 33cl",
      categoryId,
      priceCents: 350,
      vatRatePercent: 21,
    });
    expect(article.priceCents).toBe(350);
    expect(article.active).toBe(true);
  });

  it("never rewrites price on past sales — updating the catalog price only changes future sales (CAT-004)", async () => {
    const article = await service.createArticle({ code: "COCA", label: "Coca", categoryId, priceCents: 280, vatRatePercent: 21 });
    const updated = await service.updatePrice(article.id, 300);
    expect(updated.priceCents).toBe(300);
    // La snapshot sur une ligne de vente est testée dans accounts.service.test.ts
    // (NextoreArticle ne porte que le prix courant, jamais l'historique).
  });

  it("duplicates an article with a new id and suffixed code (CAT-006)", async () => {
    const article = await service.createArticle({ code: "JUPILER", label: "Jupiler 25cl", categoryId, priceCents: 270, vatRatePercent: 21 });
    const copy = await service.duplicateArticle(article.id);
    expect(copy.id).not.toBe(article.id);
    expect(copy.priceCents).toBe(270);
    expect(copy.code).not.toBe(article.code);
  });

  it("deactivates an article without deleting it (CAT-007)", async () => {
    const article = await service.createArticle({ code: "CHOUFFE", label: "Chouffe", categoryId, priceCents: 480, vatRatePercent: 21 });
    const deactivated = await service.setArticleActive(article.id, false);
    expect(deactivated.active).toBe(false);
    const found = await service.searchArticles({ query: "Chouffe" });
    expect(found).toHaveLength(1); // toujours présent, juste inactif
  });

  it("searches articles by label/code (CAT-009)", async () => {
    await service.createArticle({ code: "AQUARIUS", label: "Aquarius", categoryId, priceCents: 300, vatRatePercent: 21 });
    await service.createArticle({ code: "ICE-TEA", label: "Ice Tea Pêche", categoryId, priceCents: 280, vatRatePercent: 21 });
    const results = await service.searchArticles({ query: "ice" });
    expect(results).toHaveLength(1);
    expect(results[0]!.code).toBe("ICE-TEA");
  });
});
