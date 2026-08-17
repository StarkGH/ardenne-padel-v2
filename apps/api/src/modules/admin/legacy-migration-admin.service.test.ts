import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { AuditLogRepository } from "./audit-log.repository.js";
import { AuditLogService } from "./audit-log.service.js";
import { LegacyMigrationAdminService } from "./legacy-migration-admin.service.js";

/** CDC §7.4-§7.5 — revue admin des conflits de déduplication à l'import Doinsport. */
describe("LegacyMigrationAdminService", () => {
  const prisma = new PrismaClient();
  let actorUserId: string;

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const actor = await prisma.user.create({
      data: { email: `legacy-migration-actor-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "S", lastName: "T", status: "ACTIVE", role: "ADMIN" },
    });
    actorUserId = actor.id;
  });

  function buildService() {
    return new LegacyMigrationAdminService(prisma, new AuditLogService(new AuditLogRepository(prisma)));
  }

  async function createMergeRequiredClient(mergeNote = "GSM correspond à 2 comptes V2") {
    return prisma.legacyClient.create({
      data: {
        externalId: `ext-${Date.now()}-${Math.random()}`,
        firstName: "Jean",
        lastName: "Dupont",
        email: "jean@example.com",
        migrationStatus: "MERGE_REQUIRED",
        mergeNote,
        lastSyncedAt: new Date(),
      },
    });
  }

  it("lists clients filtered by migration status, defaulting to none unless asked", async () => {
    await createMergeRequiredClient();
    await prisma.legacyClient.create({
      data: { externalId: `ext-only-${Date.now()}`, firstName: "A", lastName: "B", migrationStatus: "LEGACY_ONLY", lastSyncedAt: new Date() },
    });

    const service = buildService();
    const merged = await service.list("MERGE_REQUIRED");
    const legacyOnly = await service.list("LEGACY_ONLY");

    expect(merged).toHaveLength(1);
    expect(legacyOnly).toHaveLength(1);
  });

  it("links a MERGE_REQUIRED client to a chosen V2 user, clearing the merge note, and audits it", async () => {
    const client = await createMergeRequiredClient();
    const user = await prisma.user.create({
      data: { email: `target-${Date.now()}@example.com`, passwordHash: "x", firstName: "T", lastName: "U", status: "ACTIVE" },
    });

    const service = buildService();
    const linked = await service.linkToUser(actorUserId, client.id, user.id);

    expect(linked.migrationStatus).toBe("MIGRATED");
    expect(linked.linkedUserId).toBe(user.id);
    expect(linked.mergeNote).toBeNull();

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "LegacyClient", targetId: client.id });
    expect(entries.some((e) => e.action === "LEGACY_CLIENT_LINKED")).toBe(true);
  });

  it("rejects linking a V2 user already linked to a different Legacy client", async () => {
    const client1 = await createMergeRequiredClient();
    const client2 = await createMergeRequiredClient();
    const user = await prisma.user.create({
      data: { email: `shared-${Date.now()}@example.com`, passwordHash: "x", firstName: "V", lastName: "W", status: "ACTIVE" },
    });

    const service = buildService();
    await service.linkToUser(actorUserId, client1.id, user.id);

    await expect(service.linkToUser(actorUserId, client2.id, user.id)).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("rejects linking a client that is already MIGRATED, without resetting first", async () => {
    const client = await createMergeRequiredClient();
    const user = await prisma.user.create({
      data: { email: `already-${Date.now()}@example.com`, passwordHash: "x", firstName: "X", lastName: "Y", status: "ACTIVE" },
    });
    const service = buildService();
    await service.linkToUser(actorUserId, client.id, user.id);

    const anotherUser = await prisma.user.create({
      data: { email: `another-${Date.now()}@example.com`, passwordHash: "x", firstName: "Z", lastName: "Z", status: "ACTIVE" },
    });
    await expect(service.linkToUser(actorUserId, client.id, anotherUser.id)).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("disables a client, keeping the reason as the merge note, and audits it", async () => {
    const client = await createMergeRequiredClient();
    const service = buildService();

    const disabled = await service.disable(actorUserId, client.id, "Personnes différentes, confirmé par téléphone");
    expect(disabled.migrationStatus).toBe("DISABLED");
    expect(disabled.mergeNote).toBe("Personnes différentes, confirmé par téléphone");

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "LegacyClient", targetId: client.id });
    expect(entries.some((e) => e.action === "LEGACY_CLIENT_DISABLED")).toBe(true);
  });

  it("resets a client back to LEGACY_ONLY, clearing merge note and any link", async () => {
    const client = await createMergeRequiredClient();
    const service = buildService();

    const reset = await service.resetToPending(actorUserId, client.id);
    expect(reset.migrationStatus).toBe("LEGACY_ONLY");
    expect(reset.mergeNote).toBeNull();
    expect(reset.linkedUserId).toBeNull();

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "LegacyClient", targetId: client.id });
    expect(entries.some((e) => e.action === "LEGACY_CLIENT_RESET")).toBe(true);
  });

  it("lists sync runs most recent first, capped to the requested limit", async () => {
    const older = await prisma.legacySyncRun.create({ data: { kind: "CLIENTS" } });
    await prisma.legacySyncRun.update({ where: { id: older.id }, data: { status: "SUCCESS", finishedAt: new Date(), itemsSeen: 1090, itemsChanged: 12 } });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await prisma.legacySyncRun.create({ data: { kind: "BOOKINGS" } });
    await prisma.legacySyncRun.update({ where: { id: newer.id }, data: { status: "PARTIAL", finishedAt: new Date(), itemsSeen: 49, itemsChanged: 49, errorSummary: "2 réservation(s) en échec" } });

    const service = buildService();
    const runs = await service.listSyncRuns(1);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.id).toBe(newer.id);
    expect(runs[0]!.status).toBe("PARTIAL");
  });

  it("rejects operations on an unknown Legacy client", async () => {
    const service = buildService();
    const unknownId = "00000000-0000-0000-0000-000000000000";
    await expect(service.disable(actorUserId, unknownId)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(service.resetToPending(actorUserId, unknownId)).rejects.toMatchObject({ httpStatus: 404 });
  });
});
