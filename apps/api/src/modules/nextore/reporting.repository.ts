import type { PrismaClient } from "@prisma/client";

/**
 * CDC §33 — pas de `$queryRaw` (seul précédent dans ce repo : `SELECT 1` du
 * health check) : `created_at`/`closed_at` sont des `timestamp(3)` sans
 * fuseau, et un paramètre `Date` passé à `$queryRaw` est resitué en session
 * timezone (`Europe/Brussels` ici) avant comparaison — décalage silencieux
 * de plusieurs heures constaté en test. La requête standard Prisma
 * (`findMany`/`gte`/`lt`) n'a pas ce problème (déjà utilisée partout
 * ailleurs dans ce module) ; l'agrégation par jour/TVA se fait donc en JS
 * sur un jeu de lignes borné par période, jamais en SQL brut.
 */
export class NextoreReportingRepository {
  constructor(private readonly db: PrismaClient) {}

  listActiveLinesInRange(from: Date, to: Date) {
    return this.db.nextoreSaleLine.findMany({
      where: { status: "ACTIVE", createdAt: { gte: from, lt: to } },
      include: { article: { include: { category: true } } },
    });
  }

  async paymentsByMethod(from: Date, to: Date) {
    const rows = await this.db.nextorePayment.groupBy({
      by: ["method"],
      where: { status: "RECORDED", createdAt: { gte: from, lt: to } },
      _sum: { amountCents: true },
      _count: true,
    });
    return rows.map((r) => ({ method: r.method, amountCents: r._sum.amountCents ?? 0, count: r._count }));
  }

  /** ACC-005 — comptes actuellement ouverts (pas de fenêtre temporelle : c'est un état courant). */
  listOpenAccounts() {
    return this.db.nextoreAccount.findMany({ where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } }, orderBy: { openedAt: "asc" } });
  }

  /** CDC §33 "comptes anciens/non réglés" — ouverts depuis plus de `olderThan`. */
  listStaleOpenAccounts(olderThan: Date) {
    return this.db.nextoreAccount.findMany({
      where: { status: { in: ["OPEN", "PARTIALLY_PAID"] }, openedAt: { lte: olderThan } },
      orderBy: { openedAt: "asc" },
    });
  }

  voidedLines(from: Date, to: Date) {
    return this.db.nextoreSaleLine.findMany({
      where: { status: "VOIDED", voidedAt: { gte: from, lt: to } },
      orderBy: { voidedAt: "desc" },
      include: { article: { select: { label: true } } },
    });
  }

  reversedPayments(from: Date, to: Date) {
    return this.db.nextorePayment.findMany({
      where: { status: "REVERSED", reversedAt: { gte: from, lt: to } },
      orderBy: { reversedAt: "desc" },
    });
  }

  /** CDC §33 "écarts de caisse" — sessions clôturées dans la période. */
  cashVariances(from: Date, to: Date) {
    return this.db.nextoreCashSession.findMany({
      where: { status: "CLOSED", closedAt: { gte: from, lt: to } },
      orderBy: { closedAt: "desc" },
      select: { id: true, closedAt: true, declaredClosingCents: true, theoreticalClosingCents: true, varianceCents: true, varianceJustification: true },
    });
  }
}
