import type { Prisma, PrismaClient } from "@prisma/client";

export class CreditPacksRepository {
  constructor(private readonly db: PrismaClient) {}

  listActive(now: Date) {
    return this.db.creditPack.findMany({
      where: {
        active: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
        ],
      },
      orderBy: { displayOrder: "asc" },
    });
  }

  findById(id: string) {
    return this.db.creditPack.findUnique({ where: { id } });
  }

  createPurchase(data: Prisma.CreditPackPurchaseCreateInput) {
    return this.db.creditPackPurchase.create({ data });
  }

  findPurchaseById(id: string) {
    return this.db.creditPackPurchase.findUnique({ where: { id } });
  }

  findPurchaseByPaymentId(paymentId: string) {
    return this.db.creditPackPurchase.findUnique({ where: { paymentId } });
  }

  updatePurchase(id: string, data: Prisma.CreditPackPurchaseUpdateInput) {
    return this.db.creditPackPurchase.update({ where: { id }, data });
  }

  /** Transition atomique et conditionnelle — garantit qu'un pack ne crédite jamais deux fois (CDC §28.2, anti-pattern §111). */
  async markCreditedIfPaid(id: string): Promise<boolean> {
    const result = await this.db.creditPackPurchase.updateMany({ where: { id, status: "PAID" }, data: { status: "CREDITED" } });
    return result.count === 1;
  }
}
