import type { ClientMigrationStatus, PrismaClient } from "@prisma/client";
import { AppError, ErrorCodes } from "@ardenne/shared";
import type { AuditLogService } from "./audit-log.service.js";

/**
 * CDC §7.4-§7.5 — revue admin des fiches "Shadow Client" (`LegacyClient`)
 * dont la déduplication automatique à l'import (Lot 11, `client-dedup.ts`)
 * n'a pas pu trancher seule. Ne construit pas le flux d'invitation
 * (`ClientMigrationInvitation`) — hors périmètre de ce lot, la revue admin
 * ne fait que lier/rejeter/reporter, jamais envoyer d'e-mail au joueur.
 */
export class LegacyMigrationAdminService {
  constructor(
    private readonly db: PrismaClient,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(status: ClientMigrationStatus) {
    return this.db.legacyClient.findMany({
      where: { migrationStatus: status },
      orderBy: { lastSyncedAt: "desc" },
      include: { linkedUser: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });
  }

  /**
   * Lien manuel décidé par un humain (CDC §7.5, priorité 3 : "validation
   * manuelle administrateur en cas de conflit"). Autorisé depuis
   * `MERGE_REQUIRED` (le cas nominal) ou `LEGACY_ONLY` (un admin peut lier
   * un client jamais signalé, ex. trouvé en cherchant manuellement) — jamais
   * depuis `MIGRATED`/`INVITED`/`MIGRATION_PENDING`/`DISABLED` sans passer
   * par `resetToPending` d'abord, pour ne jamais écraser silencieusement un
   * état déjà résolu ou un flux d'invitation en cours.
   */
  async linkToUser(actorUserId: string, legacyClientId: string, userId: string) {
    const client = await this.db.legacyClient.findUnique({ where: { id: legacyClientId } });
    if (!client) throw new AppError(ErrorCodes.NOT_FOUND, "Client Legacy introuvable.", 404);
    if (!["MERGE_REQUIRED", "LEGACY_ONLY"].includes(client.migrationStatus)) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, `Ce client est en statut ${client.migrationStatus} — le remettre en attente avant de le relier.`, 409);
    }

    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ErrorCodes.NOT_FOUND, "Compte V2 introuvable.", 404);

    const alreadyLinked = await this.db.legacyClient.findUnique({ where: { linkedUserId: userId } });
    if (alreadyLinked && alreadyLinked.id !== client.id) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, `Ce compte V2 est déjà lié à un autre client Legacy (${alreadyLinked.externalId}).`, 409);
    }

    const updated = await this.db.legacyClient.update({
      where: { id: client.id },
      data: { migrationStatus: "MIGRATED", linkedUserId: userId, mergeNote: null },
    });
    await this.auditLog.record({
      actorUserId,
      action: "LEGACY_CLIENT_LINKED",
      targetType: "LegacyClient",
      targetId: client.id,
      before: { migrationStatus: client.migrationStatus, linkedUserId: client.linkedUserId },
      after: { migrationStatus: updated.migrationStatus, linkedUserId: updated.linkedUserId },
    });
    return updated;
  }

  /** Rejet définitif — ce client Legacy ne sera plus jamais proposé à la migration automatique. */
  async disable(actorUserId: string, legacyClientId: string, reason?: string) {
    const client = await this.db.legacyClient.findUnique({ where: { id: legacyClientId } });
    if (!client) throw new AppError(ErrorCodes.NOT_FOUND, "Client Legacy introuvable.", 404);

    const updated = await this.db.legacyClient.update({
      where: { id: client.id },
      data: { migrationStatus: "DISABLED", mergeNote: reason ?? client.mergeNote },
    });
    await this.auditLog.record({
      actorUserId,
      action: "LEGACY_CLIENT_DISABLED",
      targetType: "LegacyClient",
      targetId: client.id,
      before: { migrationStatus: client.migrationStatus },
      after: { migrationStatus: updated.migrationStatus },
      reason,
    });
    return updated;
  }

  /**
   * Reporte la décision : repasse en `LEGACY_ONLY`, efface `mergeNote`. Le
   * prochain import relancera la déduplication automatique dessus (utile si
   * le conflit se résout de lui-même, ex. un doublon de compte V2 supprimé).
   */
  async resetToPending(actorUserId: string, legacyClientId: string) {
    const client = await this.db.legacyClient.findUnique({ where: { id: legacyClientId } });
    if (!client) throw new AppError(ErrorCodes.NOT_FOUND, "Client Legacy introuvable.", 404);

    const updated = await this.db.legacyClient.update({
      where: { id: client.id },
      data: { migrationStatus: "LEGACY_ONLY", mergeNote: null, linkedUserId: null },
    });
    await this.auditLog.record({
      actorUserId,
      action: "LEGACY_CLIENT_RESET",
      targetType: "LegacyClient",
      targetId: client.id,
      before: { migrationStatus: client.migrationStatus },
      after: { migrationStatus: updated.migrationStatus },
    });
    return updated;
  }
}
