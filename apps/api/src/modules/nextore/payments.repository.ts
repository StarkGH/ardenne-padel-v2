import type { Prisma, PrismaClient } from "@prisma/client";

export class NextorePaymentsRepository {
  constructor(private readonly db: PrismaClient) {}

  findByIdempotencyKey(idempotencyKey: string) {
    return this.db.nextorePayment.findUnique({ where: { idempotencyKey } });
  }

  createPending(data: Prisma.NextorePaymentCreateInput) {
    return this.db.nextorePayment.create({ data });
  }

  findById(id: string) {
    return this.db.nextorePayment.findUnique({ where: { id } });
  }

  markRecorded(id: string, walletTransactionId?: string) {
    return this.db.nextorePayment.update({ where: { id }, data: { status: "RECORDED", walletTransactionId } });
  }

  markFailed(id: string) {
    return this.db.nextorePayment.update({ where: { id }, data: { status: "FAILED" } });
  }

  /** CDC Nextore §26 (COR-002) — jamais de suppression, une contrepassation crée une entrée liée. */
  createReversal(data: Prisma.NextorePaymentCreateInput) {
    return this.db.nextorePayment.create({ data });
  }

  markReversed(id: string, reversedByUserId: string) {
    return this.db.nextorePayment.update({ where: { id }, data: { status: "REVERSED", reversedByUserId, reversedAt: new Date() } });
  }

  listForAccount(accountId: string) {
    return this.db.nextorePayment.findMany({ where: { accountId }, orderBy: { createdAt: "asc" } });
  }

  /** ACC-007 — total encaissé net (paiements RECORDED, hors PENDING/FAILED/REVERSED). */
  async getRecordedTotalCents(accountId: string): Promise<number> {
    const result = await this.db.nextorePayment.aggregate({
      where: { accountId, status: "RECORDED" },
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0;
  }
}
