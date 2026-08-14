import type { Prisma, PrismaClient } from "@prisma/client";

export class NotificationOutboxRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.NotificationOutboxCreateInput) {
    return this.db.notificationOutbox.create({ data });
  }

  findDue(now: Date, limit: number) {
    return this.db.notificationOutbox.findMany({
      where: { status: "PENDING", scheduledFor: { lte: now } },
      orderBy: { scheduledFor: "asc" },
      take: limit,
    });
  }

  markSent(id: string) {
    return this.db.notificationOutbox.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
  }

  markFailed(id: string, attempts: number, lastError: string, terminal: boolean) {
    return this.db.notificationOutbox.update({
      where: { id },
      data: { attempts, lastError, status: terminal ? "FAILED" : "PENDING" },
    });
  }

  findById(id: string) {
    return this.db.notificationOutbox.findUnique({ where: { id } });
  }
}
