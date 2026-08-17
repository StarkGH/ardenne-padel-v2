import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";

/**
 * CDC §7.3-§7.5, §10.3 — modèle de données pour l'import Doinsport (ADR-0031).
 * Ne teste pas encore le job de synchro lui-même (pas construit) : vérifie
 * seulement que le schéma porte correctement les invariants attendus.
 */
describe("Modèle d'import Legacy (LegacyClient/ClientMigrationInvitation/LegacyBooking/LegacySyncRun)", () => {
  const prisma = new PrismaClient();
  let courtId: string;
  let userId: string;

  beforeAll(async () => {
    const court = await prisma.court.upsert({
      where: { slug: "test-padel-legacy-import" },
      update: {},
      create: { slug: "test-padel-legacy-import", name: "Test Padel Legacy Import", courtType: "DOUBLE", capacity: 4, displayOrder: 88 },
    });
    courtId = court.id;
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.court.delete({ where: { id: courtId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const user = await prisma.user.create({
      data: { email: `legacy-import-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "L", lastName: "I", status: "ACTIVE" },
    });
    userId = user.id;
  });

  it("defaults a newly synced client to LEGACY_ONLY", async () => {
    const client = await prisma.legacyClient.create({
      data: { externalId: `ext-${Date.now()}`, firstName: "Jean", lastName: "Dupont", email: "jean@example.com", lastSyncedAt: new Date() },
    });
    expect(client.migrationStatus).toBe("LEGACY_ONLY");
    expect(client.linkedUserId).toBeNull();
  });

  it("walks a client through the migration state machine to MIGRATED and links it to a V2 user", async () => {
    const client = await prisma.legacyClient.create({
      data: { externalId: `ext-${Date.now()}`, firstName: "Marie", lastName: "Curie", email: "marie@example.com", lastSyncedAt: new Date() },
    });

    await prisma.legacyClient.update({ where: { id: client.id }, data: { migrationStatus: "INVITED" } });
    const invitation = await prisma.clientMigrationInvitation.create({
      data: { legacyClientId: client.id, tokenHash: `hash-${Date.now()}`, expiresAt: new Date(Date.now() + 3600_000) },
    });
    expect(invitation.usedAt).toBeNull();

    await prisma.clientMigrationInvitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } });
    const migrated = await prisma.legacyClient.update({
      where: { id: client.id },
      data: { migrationStatus: "MIGRATED", linkedUserId: userId },
    });
    expect(migrated.migrationStatus).toBe("MIGRATED");
    expect(migrated.linkedUserId).toBe(userId);

    const withUser = await prisma.legacyClient.findUnique({ where: { id: client.id }, include: { linkedUser: true } });
    expect(withUser?.linkedUser?.id).toBe(userId);
  });

  it("rejects linking two different Shadow Clients to the same V2 user (CDC §7.5 — one V2 account, one Legacy identity)", async () => {
    await prisma.legacyClient.create({
      data: { externalId: `ext-a-${Date.now()}`, firstName: "A", lastName: "A", lastSyncedAt: new Date(), linkedUserId: userId, migrationStatus: "MIGRATED" },
    });
    await expect(
      prisma.legacyClient.create({
        data: { externalId: `ext-b-${Date.now()}`, firstName: "B", lastName: "B", lastSyncedAt: new Date(), linkedUserId: userId, migrationStatus: "MIGRATED" },
      }),
    ).rejects.toThrow();
  });

  it("deleting a Shadow Client cascades to its migration invitations", async () => {
    const client = await prisma.legacyClient.create({
      data: { externalId: `ext-${Date.now()}`, firstName: "P", lastName: "Q", lastSyncedAt: new Date() },
    });
    const invitation = await prisma.clientMigrationInvitation.create({
      data: { legacyClientId: client.id, tokenHash: `hash-${Date.now()}`, expiresAt: new Date(Date.now() + 3600_000) },
    });

    await prisma.legacyClient.delete({ where: { id: client.id } });

    const stillThere = await prisma.clientMigrationInvitation.findUnique({ where: { id: invitation.id } });
    expect(stillThere).toBeNull();
  });

  it("stores one LegacyBooking row per occupied court, queryable by court and time range for anti-collision (CDC §10.3)", async () => {
    const start = new Date("2026-09-01T10:00:00.000Z");
    const end = new Date("2026-09-01T11:00:00.000Z");
    await prisma.legacyBooking.create({
      data: { externalId: "legacy-booking-1", courtId, startAt: start, endAt: end, lastSyncedAt: new Date() },
    });

    const occupying = await prisma.legacyBooking.findMany({
      where: { courtId, canceled: false, startAt: { lt: new Date("2026-09-01T11:30:00.000Z") }, endAt: { gt: new Date("2026-09-01T09:30:00.000Z") } },
    });
    expect(occupying).toHaveLength(1);
    expect(occupying[0]!.legacyClientId).toBeNull(); // pas encore résolu par le mapping DTO actuel (dépendance notée dans ADR-0031)
  });

  it("excludes canceled Legacy bookings from the occupying set", async () => {
    const start = new Date("2026-09-02T10:00:00.000Z");
    await prisma.legacyBooking.create({
      data: { externalId: "legacy-booking-canceled", courtId, startAt: start, endAt: new Date("2026-09-02T11:00:00.000Z"), canceled: true, lastSyncedAt: new Date() },
    });

    const occupying = await prisma.legacyBooking.findMany({ where: { courtId, canceled: false, startAt: start } });
    expect(occupying).toHaveLength(0);
  });

  it("allows re-syncing the same external booking on the same court without duplicating it (upsert target)", async () => {
    await prisma.legacyBooking.create({
      data: { externalId: "legacy-booking-upsert", courtId, startAt: new Date("2026-09-03T10:00:00.000Z"), endAt: new Date("2026-09-03T11:00:00.000Z"), lastSyncedAt: new Date() },
    });

    const upserted = await prisma.legacyBooking.upsert({
      where: { externalId_courtId: { externalId: "legacy-booking-upsert", courtId } },
      update: { canceled: true, lastSyncedAt: new Date() },
      create: { externalId: "legacy-booking-upsert", courtId, startAt: new Date("2026-09-03T10:00:00.000Z"), endAt: new Date("2026-09-03T11:00:00.000Z"), lastSyncedAt: new Date() },
    });
    expect(upserted.canceled).toBe(true);

    const all = await prisma.legacyBooking.findMany({ where: { externalId: "legacy-booking-upsert" } });
    expect(all).toHaveLength(1);
  });

  it("records a sync job run and lets it be marked SUCCESS with counts", async () => {
    const run = await prisma.legacySyncRun.create({ data: { kind: "CLIENTS" } });
    expect(run.status).toBe("RUNNING");

    const finished = await prisma.legacySyncRun.update({
      where: { id: run.id },
      data: { status: "SUCCESS", finishedAt: new Date(), itemsSeen: 42, itemsChanged: 5 },
    });
    expect(finished.status).toBe("SUCCESS");
    expect(finished.itemsChanged).toBe(5);
  });
});
