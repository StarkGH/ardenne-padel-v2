import type { Prisma, PrismaClient } from "@prisma/client";

export class BookingGuaranteeRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.BookingGuaranteeCreateInput) {
    return this.db.bookingGuarantee.create({ data });
  }

  findByBookingId(bookingId: string) {
    return this.db.bookingGuarantee.findUnique({ where: { bookingId } });
  }

  /** Décrément conditionnel — jamais de lecture-puis-écriture séparée (évite une race sur les paiements concurrents de parts). */
  async releaseAmount(bookingId: string, amountCents: number): Promise<boolean> {
    const result = await this.db.bookingGuarantee.updateMany({
      where: { bookingId, status: { in: ["ACTIVE", "PARTIALLY_RELEASED"] }, remainingGuaranteedCents: { gte: amountCents } },
      data: { remainingGuaranteedCents: { decrement: amountCents } },
    });
    return result.count === 1;
  }

  markStatus(bookingId: string, status: "PARTIALLY_RELEASED" | "RELEASED" | "CONSUMED" | "FAILED", extra: Prisma.BookingGuaranteeUpdateInput = {}) {
    return this.db.bookingGuarantee.update({ where: { bookingId }, data: { status, ...extra } });
  }
}
