import type { Prisma, PrismaClient } from "@prisma/client";

export class StaffAccessCodeRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.StaffAccessCodeCreateInput) {
    return this.db.staffAccessCode.create({ data, include: { zones: { include: { zone: true } } } });
  }

  listActive() {
    return this.db.staffAccessCode.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      include: { zones: { include: { zone: true } } },
    });
  }

  findById(id: string) {
    return this.db.staffAccessCode.findUnique({ where: { id } });
  }

  revoke(id: string) {
    return this.db.staffAccessCode.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date() } });
  }

  /** Snapshot device : codes actifs, non expirés, portant l'une des zones demandées. */
  findActiveForZoneIds(zoneIds: string[]) {
    return this.db.staffAccessCode.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        zones: { some: { zoneId: { in: zoneIds } } },
      },
      include: { zones: { include: { zone: true } } },
    });
  }

  /** Nettoyage best-effort (même logique que `AccessCommand.expireStaleCommands`) — appelé à chaque snapshot. */
  expireStale() {
    return this.db.staffAccessCode.updateMany({
      where: { status: "ACTIVE", expiresAt: { lte: new Date() } },
      data: { status: "EXPIRED" },
    });
  }
}
