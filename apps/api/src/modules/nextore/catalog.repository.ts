import type { Prisma, PrismaClient } from "@prisma/client";

export class NextoreCatalogRepository {
  constructor(private readonly db: PrismaClient) {}

  // --- Categories ---

  createCategory(data: Prisma.NextorePOSCategoryCreateInput) {
    return this.db.nextorePOSCategory.create({ data });
  }

  listCategories() {
    return this.db.nextorePOSCategory.findMany({ orderBy: [{ displayOrder: "asc" }, { label: "asc" }] });
  }

  findCategoryById(id: string) {
    return this.db.nextorePOSCategory.findUnique({ where: { id } });
  }

  updateCategory(id: string, data: Prisma.NextorePOSCategoryUpdateInput) {
    return this.db.nextorePOSCategory.update({ where: { id }, data });
  }

  // --- Articles ---

  createArticle(data: Prisma.NextoreArticleCreateInput) {
    return this.db.nextoreArticle.create({ data });
  }

  findArticleById(id: string) {
    return this.db.nextoreArticle.findUnique({ where: { id }, include: { category: true } });
  }

  updateArticle(id: string, data: Prisma.NextoreArticleUpdateInput) {
    return this.db.nextoreArticle.update({ where: { id }, data });
  }

  /** CAT-009 — recherche par libellé/code/catégorie/statut. */
  searchArticles(filter: { query?: string; categoryId?: string; active?: boolean }) {
    return this.db.nextoreArticle.findMany({
      where: {
        active: filter.active,
        categoryId: filter.categoryId,
        OR: filter.query
          ? [{ label: { contains: filter.query, mode: "insensitive" } }, { code: { contains: filter.query, mode: "insensitive" } }]
          : undefined,
      },
      include: { category: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
    });
  }

  listActiveArticlesByCategory(categoryId: string) {
    return this.db.nextoreArticle.findMany({
      where: { categoryId, active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
    });
  }
}
