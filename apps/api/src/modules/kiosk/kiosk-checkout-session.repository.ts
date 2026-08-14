import type { Prisma, PrismaClient } from "@prisma/client";

export class KioskCheckoutSessionRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.KioskCheckoutSessionCreateInput) {
    return this.db.kioskCheckoutSession.create({ data });
  }

  findById(id: string) {
    return this.db.kioskCheckoutSession.findUnique({ where: { id } });
  }

  findByTokenHash(tokenHash: string) {
    return this.db.kioskCheckoutSession.findUnique({ where: { tokenHash } });
  }

  /** Réclamation atomique — une session QR ne peut être réclamée qu'une seule fois (CDC §47.2.ter). */
  async claimIfPending(id: string, claimedByUserId: string): Promise<boolean> {
    const result = await this.db.kioskCheckoutSession.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "CLAIMED", claimedByUserId },
    });
    return result.count === 1;
  }

  setBookingId(id: string, bookingId: string) {
    return this.db.kioskCheckoutSession.update({ where: { id }, data: { bookingId } });
  }

  cancelIfPending(id: string) {
    return this.db.kioskCheckoutSession.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELED" } });
  }
}
