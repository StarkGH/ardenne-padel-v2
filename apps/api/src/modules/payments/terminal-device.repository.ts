import type { Prisma, PrismaClient } from "@prisma/client";

export class TerminalDeviceRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.TerminalDeviceCreateInput) {
    return this.db.terminalDevice.create({ data });
  }

  listActive() {
    return this.db.terminalDevice.findMany({ where: { status: { not: "REVOKED" } }, orderBy: { name: "asc" } });
  }

  touchLastSeen(id: string) {
    return this.db.terminalDevice.update({ where: { id }, data: { lastSeenAt: new Date(), status: "ACTIVE" } });
  }
}
