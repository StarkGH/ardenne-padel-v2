import type { Prisma, PrismaClient } from "@prisma/client";

export class BookingShareRepository {
  constructor(private readonly db: PrismaClient) {}

  createMany(data: Prisma.BookingShareCreateManyInput[]) {
    return this.db.bookingShare.createMany({ data });
  }

  findByBookingId(bookingId: string) {
    return this.db.bookingShare.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } });
  }

  findById(id: string) {
    return this.db.bookingShare.findUnique({ where: { id } });
  }

  findByTokenHash(tokenHash: string) {
    return this.db.bookingShare.findUnique({ where: { invitationTokenHash: tokenHash } });
  }

  setInvitation(id: string, tokenHash: string, expiresAt: Date) {
    return this.db.bookingShare.update({
      where: { id },
      data: { invitationTokenHash: tokenHash, invitationExpiresAt: expiresAt, status: "INVITED" },
    });
  }

  /** Transition atomique — une part ne peut être payée deux fois (CDC §26.2 : le lien devient inutilisable après paiement). */
  async markPaidIfPayable(id: string, data: Prisma.BookingShareUpdateInput): Promise<boolean> {
    const result = await this.db.bookingShare.updateMany({
      where: { id, status: { in: ["OPEN", "INVITED", "PAYMENT_PENDING"] } },
      data,
    });
    return result.count === 1;
  }

  updateStatus(id: string, status: Prisma.BookingShareUpdateInput["status"], extra: Prisma.BookingShareUpdateInput = {}) {
    return this.db.bookingShare.update({ where: { id }, data: { status, ...extra } });
  }

  findUnpaidByBookingId(bookingId: string) {
    return this.db.bookingShare.findMany({ where: { bookingId, status: { in: ["OPEN", "INVITED", "PAYMENT_PENDING"] } } });
  }
}
