import type { Prisma, PrismaClient } from "@prisma/client";

export class NextoreReconciliationRepository {
  constructor(private readonly db: PrismaClient) {}

  createImport(data: Prisma.NextoreReconciliationImportCreateInput) {
    return this.db.nextoreReconciliationImport.create({ data });
  }

  createEntries(data: Prisma.NextoreReconciliationEntryCreateManyInput[]) {
    return this.db.nextoreReconciliationEntry.createMany({ data });
  }

  listEntriesForImport(importId: string) {
    return this.db.nextoreReconciliationEntry.findMany({ where: { importId }, orderBy: { externalDate: "asc" } });
  }

  findEntryById(id: string) {
    return this.db.nextoreReconciliationEntry.findUnique({ where: { id } });
  }

  updateEntry(id: string, data: Prisma.NextoreReconciliationEntryUpdateInput) {
    return this.db.nextoreReconciliationEntry.update({ where: { id }, data });
  }

  /** REC0-004 — vue d'exception : tout ce qui n'est pas MATCHED, toutes campagnes confondues. */
  listExceptions() {
    return this.db.nextoreReconciliationEntry.findMany({
      where: { status: { in: ["UNMATCHED", "AMBIGUOUS"] } },
      orderBy: { externalDate: "desc" },
    });
  }

  /**
   * Candidats de rapprochement : paiements carte enregistrés, montant exact
   * (REC0-007), dans une fenêtre temporelle autour de la date bancaire, et
   * pas déjà rapprochés par une autre entrée MATCHED.
   */
  async findCandidatePayments(amountCents: number, from: Date, to: Date) {
    const alreadyMatched = await this.db.nextoreReconciliationEntry.findMany({
      where: { status: "MATCHED", matchedPaymentId: { not: null } },
      select: { matchedPaymentId: true },
    });
    const excludeIds = alreadyMatched.map((e) => e.matchedPaymentId!).filter(Boolean);

    return this.db.nextorePayment.findMany({
      where: {
        method: "CARD",
        status: "RECORDED",
        amountCents,
        createdAt: { gte: from, lte: to },
        id: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
      },
    });
  }

  /** Paiements carte enregistrés sans aucune entrée MATCHED pointant vers eux — signal d'un import bancaire manquant ou incomplet. */
  async listUnreconciledCardPayments(olderThan: Date) {
    const matched = await this.db.nextoreReconciliationEntry.findMany({
      where: { status: "MATCHED", matchedPaymentId: { not: null } },
      select: { matchedPaymentId: true },
    });
    const matchedIds = matched.map((e) => e.matchedPaymentId!).filter(Boolean);

    return this.db.nextorePayment.findMany({
      where: {
        method: "CARD",
        status: "RECORDED",
        createdAt: { lte: olderThan },
        id: matchedIds.length > 0 ? { notIn: matchedIds } : undefined,
      },
      orderBy: { createdAt: "asc" },
    });
  }
}
