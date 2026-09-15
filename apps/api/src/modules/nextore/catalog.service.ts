import { AppError, ErrorCodes } from "@ardenne/shared";
import type { NextoreCatalogRepository } from "./catalog.repository.js";

export interface CreateArticleInput {
  code: string;
  label: string;
  shortLabel?: string;
  categoryId: string;
  priceCents: number;
  vatRatePercent: number;
  photoUrl?: string;
  displayOrder?: number;
  internalProductRef?: string;
}

/**
 * CDC Nextore §8 (catalogue). Le prix/TVA capturés sur `NextoreArticle` ne
 * sont jamais relus rétroactivement par une vente déjà enregistrée
 * (CAT-004) — `NextoreSaleLine` snapshot le prix au moment de l'ajout,
 * cette classe ne gère que l'état courant du catalogue.
 */
export class NextoreCatalogService {
  constructor(private readonly repo: NextoreCatalogRepository) {}

  async createCategory(input: { label: string; parentId?: string; displayOrder?: number }) {
    if (!input.label.trim()) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le libellé de catégorie est obligatoire.", 422);
    }
    return this.repo.createCategory({
      label: input.label,
      displayOrder: input.displayOrder ?? 0,
      ...(input.parentId ? { parent: { connect: { id: input.parentId } } } : {}),
    });
  }

  listCategories() {
    return this.repo.listCategories();
  }

  async setCategoryActive(id: string, active: boolean) {
    const category = await this.repo.findCategoryById(id);
    if (!category) throw new AppError(ErrorCodes.NOT_FOUND, "Catégorie introuvable.", 404);
    return this.repo.updateCategory(id, { active });
  }

  async createArticle(input: CreateArticleInput) {
    if (!input.label.trim() || !input.code.trim()) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le libellé et le code de l'article sont obligatoires.", 422);
    }
    if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le prix doit être un entier de centimes positif.", 422);
    }
    const category = await this.repo.findCategoryById(input.categoryId);
    if (!category) throw new AppError(ErrorCodes.NOT_FOUND, "Catégorie introuvable.", 404);

    return this.repo.createArticle({
      code: input.code,
      label: input.label,
      shortLabel: input.shortLabel,
      category: { connect: { id: input.categoryId } },
      priceCents: input.priceCents,
      vatRatePercent: input.vatRatePercent,
      photoUrl: input.photoUrl,
      displayOrder: input.displayOrder ?? 0,
      internalProductRef: input.internalProductRef,
    });
  }

  /** CAT-006 — duplication : reprend les données pertinentes, nouvel id, code suffixé. */
  async duplicateArticle(id: string) {
    const source = await this.repo.findArticleById(id);
    if (!source) throw new AppError(ErrorCodes.NOT_FOUND, "Article introuvable.", 404);

    return this.repo.createArticle({
      code: `${source.code}-COPY-${Date.now()}`,
      label: `${source.label} (copie)`,
      shortLabel: source.shortLabel,
      category: { connect: { id: source.categoryId } },
      priceCents: source.priceCents,
      vatRatePercent: source.vatRatePercent,
      photoUrl: source.photoUrl,
      displayOrder: source.displayOrder,
      internalProductRef: source.internalProductRef,
    });
  }

  /** CAT-004 — modifier le prix courant n'altère jamais les ventes déjà snapshotées. */
  async updatePrice(id: string, priceCents: number) {
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Le prix doit être un entier de centimes positif.", 422);
    }
    const article = await this.repo.findArticleById(id);
    if (!article) throw new AppError(ErrorCodes.NOT_FOUND, "Article introuvable.", 404);
    return this.repo.updateArticle(id, { priceCents });
  }

  /** CAT-007 — désactivation sans suppression, l'historique de vente reste intact. */
  async setArticleActive(id: string, active: boolean) {
    const article = await this.repo.findArticleById(id);
    if (!article) throw new AppError(ErrorCodes.NOT_FOUND, "Article introuvable.", 404);
    return this.repo.updateArticle(id, { active });
  }

  searchArticles(filter: { query?: string; categoryId?: string; active?: boolean }) {
    return this.repo.searchArticles(filter);
  }

  listActiveArticlesByCategory(categoryId: string) {
    return this.repo.listActiveArticlesByCategory(categoryId);
  }
}
