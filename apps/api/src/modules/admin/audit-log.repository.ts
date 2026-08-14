import type { Prisma, PrismaClient } from "@prisma/client";

export class AuditLogRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.AuditLogCreateInput) {
    return this.db.auditLog.create({ data });
  }

  listRecent(filter: { targetType?: string; targetId?: string; actorUserId?: string }, limit = 100) {
    return this.db.auditLog.findMany({
      where: filter,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
