import type { Prisma, PrismaClient, WalletCreditOrigin } from "@prisma/client";

/** Types de transaction qui affectent réellement `balance_total` (jamais les entrées d'audit HOLD_*). */
const BALANCE_AFFECTING_TYPES = [
  "CREDIT_PACK_PURCHASE",
  "CREDIT_PACK_BONUS",
  "CREDIT_ADMIN",
  "DEBIT_BOOKING",
  "REFUND_BOOKING",
  "ADJUSTMENT",
  "BONUS_EXPIRY",
] as const;

export class WalletRepository {
  constructor(private readonly db: PrismaClient) {}

  findAccountByUserId(userId: string) {
    return this.db.walletAccount.findUnique({ where: { userId } });
  }

  async ensureAccount(userId: string) {
    const existing = await this.db.walletAccount.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.db.walletAccount.create({ data: { userId } });
  }

  createTransaction(data: Prisma.WalletTransactionCreateInput) {
    return this.db.walletTransaction.create({ data });
  }

  listTransactions(walletAccountId: string, limit = 100) {
    return this.db.walletTransaction.findMany({
      where: { walletAccountId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  createTransactions(data: Prisma.WalletTransactionCreateManyInput[]) {
    return this.db.walletTransaction.createMany({ data });
  }

  /** Somme des transactions qui affectent réellement le solde (jamais les entrées d'audit de hold). */
  async getBalanceTotalCents(walletAccountId: string): Promise<number> {
    const result = await this.db.walletTransaction.aggregate({
      where: { walletAccountId, type: { in: [...BALANCE_AFFECTING_TYPES] } },
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0;
  }

  /** Détail du solde par origine (payé/bonus/offert) — nécessaire pour la restitution fidèle au remboursement (CDC §28.10). */
  async getBalanceByOrigin(walletAccountId: string): Promise<Record<WalletCreditOrigin, number>> {
    const rows = await this.db.walletTransaction.groupBy({
      by: ["creditOrigin"],
      where: { walletAccountId, type: { in: [...BALANCE_AFFECTING_TYPES] }, creditOrigin: { not: null } },
      _sum: { amountCents: true },
    });
    const result: Record<WalletCreditOrigin, number> = { PAID: 0, BONUS: 0, ADMIN_COMP: 0 };
    for (const row of rows) {
      if (row.creditOrigin) result[row.creditOrigin] = row._sum.amountCents ?? 0;
    }
    return result;
  }

  async getReservedCents(walletAccountId: string): Promise<number> {
    const result = await this.db.walletHold.aggregate({
      where: { walletAccountId, status: "ACTIVE" },
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0;
  }

  createHold(data: Prisma.WalletHoldCreateInput) {
    return this.db.walletHold.create({ data });
  }

  findHoldById(id: string) {
    return this.db.walletHold.findUnique({ where: { id } });
  }

  findActiveHoldForBooking(bookingId: string) {
    return this.db.walletHold.findFirst({ where: { bookingId, status: "ACTIVE" } });
  }

  /** Transition atomique et conditionnelle — un hold ne peut être capturé/libéré deux fois (CDC §47.2.bis). */
  async transitionHold(id: string, fromStatus: "ACTIVE", data: Prisma.WalletHoldUpdateInput): Promise<boolean> {
    const result = await this.db.walletHold.updateMany({ where: { id, status: fromStatus }, data });
    return result.count === 1;
  }

  /**
   * Réduit le montant réservé d'un hold encore actif (libération partielle —
   * CDC §26, une part payée diminue la garantie sans tout libérer d'un
   * coup). Décrément atomique et conditionnel : jamais de lecture-puis-
   * écriture séparée, jamais de solde négatif.
   */
  async reduceHoldAmount(id: string, amountCents: number): Promise<boolean> {
    const result = await this.db.walletHold.updateMany({
      where: { id, status: "ACTIVE", amountCents: { gte: amountCents } },
      data: { amountCents: { decrement: amountCents } },
    });
    return result.count === 1;
  }

  /** Débits déjà appliqués pour une réservation, par origine — sert de base au remboursement (CDC §28.10). */
  async getDebitBreakdownForBooking(bookingId: string): Promise<Record<WalletCreditOrigin, number>> {
    const rows = await this.db.walletTransaction.groupBy({
      by: ["creditOrigin"],
      where: { bookingId, type: "DEBIT_BOOKING", creditOrigin: { not: null } },
      _sum: { amountCents: true },
    });
    const result: Record<WalletCreditOrigin, number> = { PAID: 0, BONUS: 0, ADMIN_COMP: 0 };
    for (const row of rows) {
      if (row.creditOrigin) result[row.creditOrigin] = Math.abs(row._sum.amountCents ?? 0);
    }
    return result;
  }

  async getRefundedBreakdownForBooking(bookingId: string): Promise<Record<WalletCreditOrigin, number>> {
    const rows = await this.db.walletTransaction.groupBy({
      by: ["creditOrigin"],
      where: { bookingId, type: "REFUND_BOOKING", creditOrigin: { not: null } },
      _sum: { amountCents: true },
    });
    const result: Record<WalletCreditOrigin, number> = { PAID: 0, BONUS: 0, ADMIN_COMP: 0 };
    for (const row of rows) {
      if (row.creditOrigin) result[row.creditOrigin] = row._sum.amountCents ?? 0;
    }
    return result;
  }
}
