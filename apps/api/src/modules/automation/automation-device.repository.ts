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

  /**
   * Lecture seule (RASPBERRY_PROTOCOL.md §"Fiabilité des commandes") : une
   * commande PENDING ou DELIVERED (non ACKée, non expirée) reste éligible et
   * doit être redélivrée à chaque snapshot tant qu'aucun ACK n'est reçu —
   * DELIVERED n'est jamais un état terminal. Ne mute jamais rien ici : la
   * transition PENDING -> DELIVERED n'a lieu que lorsque le contenu est
   * effectivement renvoyé (voir `markDelivered`), jamais sur un simple 304.
   */
  findDeliverableCommands(zoneIds: string[]) {
    return this.db.accessCommand.findMany({
      where: { status: { in: ["PENDING", "DELIVERED"] }, zoneId: { in: zoneIds }, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Transition PENDING -> DELIVERED uniquement (idempotente : ne touche pas celles déjà DELIVERED, donc `deliveredAt` reste stable entre deux livraisons successives). */
  async markDelivered(ids: string[], deviceId: string) {
    if (ids.length === 0) return;
    await this.db.accessCommand.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: { status: "DELIVERED", deliveredAt: new Date(), deviceId },
    });
  }

  /** ACK explicite du Raspberry — seule transition qui retire définitivement une commande du snapshot. */
  async ackCommand(id: string, deviceId: string): Promise<boolean> {
    const result = await this.db.accessCommand.updateMany({
      where: { id, status: "DELIVERED" },
      data: { status: "SUCCESS", ackedAt: new Date(), deviceId },
    });
    return result.count === 1;
  }

  /** Fallback si aucun ACK n'arrive avant `expiresAt` (RASPBERRY_PROTOCOL.md) — nettoyage best-effort à chaque snapshot. */
  expireStaleCommands() {
    return this.db.accessCommand.updateMany({
      where: { status: { in: ["PENDING", "DELIVERED"] }, expiresAt: { lte: new Date() } },
      data: { status: "EXPIRED" },
    });
  }
}
