import type { Prisma, PrismaClient } from "@prisma/client";

export class KioskDeviceRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.KioskDeviceCreateInput) {
    return this.db.kioskDevice.create({ data });
  }

  findByKeyHash(deviceKeyHash: string) {
    return this.db.kioskDevice.findUnique({ where: { deviceKeyHash } });
  }

  findById(id: string) {
    return this.db.kioskDevice.findUnique({ where: { id } });
  }

  listActive() {
    return this.db.kioskDevice.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  }

  touchLastSeen(id: string) {
    return this.db.kioskDevice.update({ where: { id }, data: { lastSeenAt: new Date() } });
  }

  revoke(id: string) {
    return this.db.kioskDevice.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date() } });
  }
}
