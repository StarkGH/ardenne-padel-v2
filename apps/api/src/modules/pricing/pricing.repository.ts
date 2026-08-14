import type { CourtType, PrismaClient } from "@prisma/client";

export class PricingRepository {
  constructor(private readonly db: PrismaClient) {}

  findActiveRules(courtId: string, courtType: CourtType, atDate: Date) {
    return this.db.tariffRule.findMany({
      where: {
        active: true,
        validFrom: { lte: atDate },
        AND: [
          { OR: [{ validUntil: null }, { validUntil: { gte: atDate } }] },
          { OR: [{ courtId }, { courtId: null, courtType }, { courtId: null, courtType: null }] },
        ],
      },
    });
  }
}
