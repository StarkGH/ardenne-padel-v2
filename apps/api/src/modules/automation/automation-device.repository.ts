import type { Prisma, PrismaClient } from "@prisma/client";

export class AutomationDeviceRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.AccessDeviceCreateInput) {
    return this.db.accessDevice.create({ data });
  }

  findByKeyHash(deviceKeyHash: string) {
    return this.db.accessDevice.findUnique({ where: { deviceKeyHash } });
  }

  listActive() {
    return this.db.accessDevice.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  }

  touchHeartbeat(id: string, revision: string, heartbeat: Prisma.InputJsonValue) {
    return this.db.accessDevice.update({
      where: { id },
      data: { lastSeenAt: new Date(), lastSyncRevision: revision, lastHeartbeat: heartbeat },
    });
  }

  touchLastSeen(id: string) {
    return this.db.accessDevice.update({ where: { id }, data: { lastSeenAt: new Date() } });
  }

  revoke(id: string) {
    return this.db.accessDevice.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date() } });
  }

  /** Idempotence CDC (dossier technique §33/§41) : un doublon réseau (deviceId, eventId) ne remonte jamais deux fois. */
  async recordEvents(deviceId: string, events: Array<{ eventId: string; type: string; payload?: unknown; occurredAt: Date }>) {
    let accepted = 0;
    let duplicates = 0;
    for (const evt of events) {
      try {
        await this.db.accessDeviceEvent.create({
          data: {
            deviceId,
            eventId: evt.eventId,
            type: evt.type,
            payload: evt.payload as Prisma.InputJsonValue | undefined,
            occurredAt: evt.occurredAt,
          },
        });
        accepted++;
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002") {
          duplicates++;
          continue;
        }
        throw err;
      }
    }
    return { accepted, duplicates };
  }

  listRecentEvents(deviceId: string, limit: number) {
    return this.db.accessDeviceEvent.findMany({ where: { deviceId }, orderBy: { occurredAt: "desc" }, take: limit });
  }

  createCommand(data: Prisma.AccessCommandCreateInput) {
    return this.db.accessCommand.create({ data });
  }

  /** Pull uniquement (dossier technique §36 : le Raspberry n'accepte aucune connexion entrante). */
  async pullPendingCommands(deviceId: string, zoneIds: string[]) {
    const pending = await this.db.accessCommand.findMany({
      where: { status: "PENDING", zoneId: { in: zoneIds }, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "asc" },
    });
    if (pending.length > 0) {
      await this.db.accessCommand.updateMany({
        where: { id: { in: pending.map((c) => c.id) } },
        data: { status: "DELIVERED", deliveredAt: new Date(), deviceId },
      });
    }
    return pending;
  }
}
