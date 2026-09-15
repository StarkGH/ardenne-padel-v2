import type { Prisma, PrismaClient } from "@prisma/client";

export class NextoreCashSessionRepository {
  constructor(private readonly db: PrismaClient) {}

  findOpenSession() {
    return this.db.nextoreCashSession.findFirst({ where: { status: "OPEN" } });
  }

  findById(id: string) {
    return this.db.nextoreCashSession.findUnique({ where: { id }, include: { movements: true } });
  }

  create(data: Prisma.NextoreCashSessionCreateInput) {
    return this.db.nextoreCashSession.create({ data });
  }

  close(id: string, data: Prisma.NextoreCashSessionUpdateInput) {
    return this.db.nextoreCashSession.update({ where: { id }, data: { ...data, status: "CLOSED" } });
  }

  addMovement(data: Prisma.NextoreCashMovementCreateInput) {
    return this.db.nextoreCashMovement.create({ data });
  }

  listMovements(sessionId: string) {
    return this.db.nextoreCashMovement.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
  }

  /** CASH-007 — paiements cash RECORDED rattachés à la session, base du théorique de clôture. */
  async getCashPaymentsTotalCents(sessionId: string): Promise<number> {
    const result = await this.db.nextorePayment.aggregate({
      where: { cashSessionId: sessionId, method: "CASH", status: "RECORDED" },
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0;
  }

  /** Ventilation des encaissements par moyen de paiement (CASH-010). */
  async getPaymentsByMethod(sessionId: string): Promise<Record<string, number>> {
    const rows = await this.db.nextorePayment.groupBy({
      by: ["method"],
      where: { cashSessionId: sessionId, status: "RECORDED" },
      _sum: { amountCents: true },
    });
    const result: Record<string, number> = {};
    for (const row of rows) result[row.method] = row._sum.amountCents ?? 0;
    return result;
  }

  countReversalsForSession(sessionId: string) {
    return this.db.nextorePayment.count({ where: { cashSessionId: sessionId, status: "REVERSED" } });
  }
}
