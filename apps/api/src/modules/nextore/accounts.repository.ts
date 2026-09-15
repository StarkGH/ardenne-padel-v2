import type { Prisma, PrismaClient } from "@prisma/client";

export class NextoreAccountsRepository {
  constructor(private readonly db: PrismaClient) {}

  createAccount(data: Prisma.NextoreAccountCreateInput) {
    return this.db.nextoreAccount.create({ data });
  }

  findById(id: string) {
    return this.db.nextoreAccount.findUnique({
      where: { id },
      include: { participants: true, saleLines: { where: { status: "ACTIVE" } } },
    });
  }

  listOpen() {
    return this.db.nextoreAccount.findMany({
      where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } },
      orderBy: { openedAt: "desc" },
    });
  }

  /**
   * Verrouillage optimiste (CDC Nextore §30.3) : la mise à jour n'a d'effet
   * que si `version` correspond encore à ce que l'appelant a lu. `count`
   * permet au service de distinguer "appliqué" de "conflit concurrent",
   * même motif que `WalletRepository.transitionHold`.
   */
  async updateWithVersionCheck(id: string, expectedVersion: number, data: Prisma.NextoreAccountUpdateInput): Promise<boolean> {
    const result = await this.db.nextoreAccount.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  }

  addParticipant(data: Prisma.NextoreParticipantCreateInput) {
    return this.db.nextoreParticipant.create({ data });
  }

  findParticipantById(id: string) {
    return this.db.nextoreParticipant.findUnique({ where: { id } });
  }

  setParticipantLeft(id: string, leftAt: Date) {
    return this.db.nextoreParticipant.update({ where: { id }, data: { leftAt } });
  }

  addLine(data: Prisma.NextoreSaleLineCreateInput) {
    return this.db.nextoreSaleLine.create({ data });
  }

  findLineById(id: string) {
    return this.db.nextoreSaleLine.findUnique({ where: { id } });
  }

  voidLine(id: string, input: { voidReason: string; voidedByUserId: string; voidedAt: Date }) {
    return this.db.nextoreSaleLine.update({
      where: { id },
      data: { status: "VOIDED", voidReason: input.voidReason, voidedByUserId: input.voidedByUserId, voidedAt: input.voidedAt },
    });
  }

  listActiveLines(accountId: string) {
    return this.db.nextoreSaleLine.findMany({ where: { accountId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  }
}
