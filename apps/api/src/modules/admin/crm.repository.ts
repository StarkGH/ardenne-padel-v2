import type { PrismaClient } from "@prisma/client";

/**
 * CDC §40 — fiche client admin. Requêtes volontairement transversales
 * (bookings, payments, refunds, holds), propres à ce module d'agrégation
 * plutôt qu'ajoutées aux repositories métier de chaque domaine (qui n'ont
 * pas besoin de connaître ce cas d'usage admin).
 */
export class CrmRepository {
  constructor(private readonly db: PrismaClient) {}

  searchUsers(query: string, limit = 25) {
    return this.db.user.findMany({
      where: {
        OR: [{ email: { contains: query, mode: "insensitive" } }, { firstName: { contains: query, mode: "insensitive" } }, { lastName: { contains: query, mode: "insensitive" } }],
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true, createdAt: true },
      take: limit,
      orderBy: { createdAt: "desc" },
    });
  }

  findUserProfile(userId: string) {
    return this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
  }

  findLegacyClientForUser(userId: string) {
    return this.db.legacyClient.findFirst({ where: { linkedUserId: userId } });
  }

  listBookingsForUser(userId: string, now: Date) {
    return this.db.booking.findMany({
      where: { organizerUserId: userId },
      orderBy: { startAt: "desc" },
      include: { court: true, legacyBookingMapping: true },
    }).then((rows) => ({
      future: rows.filter((b) => b.startAt >= now),
      past: rows.filter((b) => b.startAt < now),
    }));
  }

  listPaymentsForUser(userId: string) {
    return this.db.payment.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  }

  listRefundsForUser(userId: string) {
    return this.db.refund.findMany({ where: { payment: { userId } }, orderBy: { createdAt: "desc" } });
  }

  listCreditPackPurchasesForUser(userId: string) {
    return this.db.creditPackPurchase.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  }

  listActiveHoldsForWallet(walletAccountId: string) {
    return this.db.walletHold.findMany({ where: { walletAccountId, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
  }
}
