import { AppError, ErrorCodes } from "@ardenne/shared";
import type { NextoreReportingRepository } from "./reporting.repository.js";

function parseRange(from?: string, to?: string): { from: Date; to: Date } {
  const fromDate = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
  const toDate = to ? new Date(to) : new Date();
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Dates invalides.", 422);
  }
  if (fromDate >= toDate) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "La date de début doit précéder la date de fin.", 422);
  }
  return { from: fromDate, to: toDate };
}

function lineAmountCents(line: { quantity: unknown; unitPriceCentsAtSale: number }): number {
  return Math.round(Number(line.quantity) * line.unitPriceCentsAtSale);
}

/** CDC Nextore §33 — reporting opérationnel. Lecture seule stricte, aucune mutation ici. */
export class NextoreReportingService {
  constructor(private readonly repo: NextoreReportingRepository) {}

  async salesByDay(from?: string, to?: string) {
    const range = parseRange(from, to);
    const lines = await this.repo.listActiveLinesInRange(range.from, range.to);
    const byDay = new Map<string, { amountCents: number; lineCount: number }>();
    for (const line of lines) {
      const day = line.createdAt.toISOString().slice(0, 10);
      const entry = byDay.get(day) ?? { amountCents: 0, lineCount: 0 };
      entry.amountCents += lineAmountCents(line);
      entry.lineCount += 1;
      byDay.set(day, entry);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v }));
  }

  async salesByArticle(from?: string, to?: string) {
    const range = parseRange(from, to);
    const lines = await this.repo.listActiveLinesInRange(range.from, range.to);
    const byArticle = new Map<string, { label: string; qty: number; amountCents: number }>();
    for (const line of lines) {
      const entry = byArticle.get(line.articleId) ?? { label: line.article.label, qty: 0, amountCents: 0 };
      entry.qty += Number(line.quantity);
      entry.amountCents += lineAmountCents(line);
      byArticle.set(line.articleId, entry);
    }
    return [...byArticle.entries()]
      .sort(([, a], [, b]) => b.amountCents - a.amountCents)
      .map(([articleId, v]) => ({ articleId, ...v }));
  }

  async salesByCategory(from?: string, to?: string) {
    const range = parseRange(from, to);
    const lines = await this.repo.listActiveLinesInRange(range.from, range.to);
    const byCategory = new Map<string, { label: string; amountCents: number }>();
    for (const line of lines) {
      const category = line.article.category;
      const entry = byCategory.get(category.id) ?? { label: category.label, amountCents: 0 };
      entry.amountCents += lineAmountCents(line);
      byCategory.set(category.id, entry);
    }
    return [...byCategory.entries()]
      .sort(([, a], [, b]) => b.amountCents - a.amountCents)
      .map(([categoryId, v]) => ({ categoryId, ...v }));
  }

  /** CDC §35 — ventilation TVA (base TTC par taux appliqué au moment de la vente). */
  async salesByVatRate(from?: string, to?: string) {
    const range = parseRange(from, to);
    const lines = await this.repo.listActiveLinesInRange(range.from, range.to);
    const byRate = new Map<string, number>();
    for (const line of lines) {
      const rate = line.vatRateAtSalePercent.toString();
      byRate.set(rate, (byRate.get(rate) ?? 0) + lineAmountCents(line));
    }
    return [...byRate.entries()]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([vatRatePercent, amountTtcCents]) => ({ vatRatePercent, amountTtcCents }));
  }

  async paymentsByMethod(from?: string, to?: string) {
    const range = parseRange(from, to);
    return this.repo.paymentsByMethod(range.from, range.to);
  }

  listOpenAccounts() {
    return this.repo.listOpenAccounts();
  }

  /** Comptes ouverts depuis plus de `olderThanHours` (défaut 24h — un compte bar ne devrait pas rester ouvert un jour entier). */
  listStaleOpenAccounts(olderThanHours = 24) {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - olderThanHours);
    return this.repo.listStaleOpenAccounts(cutoff);
  }

  voidedLines(from?: string, to?: string) {
    const range = parseRange(from, to);
    return this.repo.voidedLines(range.from, range.to);
  }

  reversedPayments(from?: string, to?: string) {
    const range = parseRange(from, to);
    return this.repo.reversedPayments(range.from, range.to);
  }

  cashVariances(from?: string, to?: string) {
    const range = parseRange(from, to);
    return this.repo.cashVariances(range.from, range.to);
  }
}
