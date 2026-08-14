import type { Prisma, PrismaClient } from "@prisma/client";

export class AccessGrantRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.AccessGrantCreateInput) {
    return this.db.accessGrant.create({ data });
  }

  findById(id: string) {
    return this.db.accessGrant.findUnique({ where: { id } });
  }

  findByBookingId(bookingId: string) {
    return this.db.accessGrant.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } });
  }

  findActiveByBookingId(bookingId: string) {
    return this.db.accessGrant.findMany({ where: { bookingId, status: { in: ["PENDING", "ACTIVE"] } } });
  }

  /** CDC §34.2 — anti-collision : un code actif sur la même zone d'accès et une fenêtre temporelle chevauchante. */
  findOverlappingActive(scope: string, validFrom: Date, validUntil: Date) {
    return this.db.accessGrant.findMany({
      where: {
        scope,
        status: { in: ["PENDING", "ACTIVE"] },
        validFrom: { lt: validUntil },
        validUntil: { gt: validFrom },
      },
    });
  }

  updateStatus(id: string, status: "PENDING" | "ACTIVE" | "REVOKED" | "EXPIRED" | "FAILED", extra: Prisma.AccessGrantUpdateInput = {}) {
    return this.db.accessGrant.update({ where: { id }, data: { status, ...extra } });
  }
}
