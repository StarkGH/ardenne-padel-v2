import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { ZoneRepository } from "./zone.repository.js";
import { StaffAccessCodeRepository } from "./staff-access-code.repository.js";
import { StaffAccessCodeService } from "./staff-access-code.service.js";

/**
 * Codes maîtres employés (CDC : nominatifs, zone par zone, expiration
 * optionnelle — décisions confirmées explicitement avant implémentation).
 * Jamais liés à une réservation, contrairement à `AccessGrant`.
 */
describe("StaffAccessCodeService", () => {
  const prisma = new PrismaClient();
  let userId: string;

  beforeAll(() => {
    resetConfigCacheForTests();
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const user = await prisma.user.create({
      data: { email: `staff-code-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "A", lastName: "B", status: "ACTIVE" },
    });
    userId = user.id;
  });

  function buildService() {
    const config = loadConfig();
    const zoneRepo = new ZoneRepository(prisma);
    const repo = new StaffAccessCodeRepository(prisma);
    const service = new StaffAccessCodeService(repo, zoneRepo, config);
    return { service, zoneRepo };
  }

  it("creates a nominative code scoped to the requested zones only, in the NNNN# format", async () => {
    const { service, zoneRepo } = buildService();
    const doorZone = await zoneRepo.create({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
    const otherZone = await zoneRepo.create({ key: "back_entry", type: "DOOR", label: "Entrée arrière" });

    const created = await service.create({ employeeName: "Alice Employée", zoneIds: [doorZone.id], createdBy: userId });

    expect(created.employeeName).toBe("Alice Employée");
    expect(created.code).toMatch(/^\d{4}#$/);
    expect(created.zones.map((z) => z.key)).toEqual(["main_entry"]);

    const grantsForDoor = await service.findActiveGrantsForZoneIds([doorZone.id]);
    expect(grantsForDoor).toHaveLength(1);
    expect(grantsForDoor[0]!.scope).toBe("main_entry");

    // Jamais universel : n'apparaît pas sur une zone non assignée.
    const grantsForOther = await service.findActiveGrantsForZoneIds([otherZone.id]);
    expect(grantsForOther).toHaveLength(0);
  });

  it("can be scoped to multiple zones at once", async () => {
    const { service, zoneRepo } = buildService();
    const zoneA = await zoneRepo.create({ key: "zone-a", type: "DOOR", label: "Zone A" });
    const zoneB = await zoneRepo.create({ key: "zone-b", type: "DOOR", label: "Zone B" });

    const created = await service.create({ employeeName: "Bob Employé", zoneIds: [zoneA.id, zoneB.id], createdBy: userId });
    expect(created.zones.map((z) => z.key).sort()).toEqual(["zone-a", "zone-b"]);

    const grants = await service.findActiveGrantsForZoneIds([zoneA.id, zoneB.id]);
    expect(grants.map((g) => g.scope).sort()).toEqual(["zone-a", "zone-b"]);
    // Même code sur les deux zones (une identité, un code, plusieurs zones).
    expect(grants[0]!.code).toBe(grants[1]!.code);
  });

  it("rejects creation with zero zones", async () => {
    const { service } = buildService();
    await expect(service.create({ employeeName: "Sans Zone", zoneIds: [], createdBy: userId })).rejects.toThrow();
  });

  it("rejects creation for an unknown zone", async () => {
    const { service } = buildService();
    await expect(service.create({ employeeName: "Zone Inconnue", zoneIds: ["00000000-0000-0000-0000-000000000000"], createdBy: userId })).rejects.toThrow();
  });

  it("never appears in the snapshot after being revoked", async () => {
    const { service, zoneRepo } = buildService();
    const zone = await zoneRepo.create({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
    const created = await service.create({ employeeName: "Carla Employée", zoneIds: [zone.id], createdBy: userId });

    await service.revoke(created.id);

    const grants = await service.findActiveGrantsForZoneIds([zone.id]);
    expect(grants).toHaveLength(0);
    expect(await service.listActive()).toHaveLength(0);
  });

  it("rejects revoking an unknown code", async () => {
    const { service } = buildService();
    await expect(service.revoke("00000000-0000-0000-0000-000000000000")).rejects.toThrow();
  });

  /** Expiration optionnelle (décision confirmée) : un code sans date reste valable, un code expiré disparaît du snapshot. */
  describe("expiration optionnelle", () => {
    it("a code without expiresAt never expires on its own", async () => {
      const { service, zoneRepo } = buildService();
      const zone = await zoneRepo.create({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
      await service.create({ employeeName: "Permanent", zoneIds: [zone.id], createdBy: userId });

      const grants = await service.findActiveGrantsForZoneIds([zone.id]);
      expect(grants).toHaveLength(1);
      // Valable très loin dans le futur (pas de vraie date d'expiration côté serveur).
      expect(grants[0]!.validUntil.getFullYear()).toBeGreaterThan(new Date().getFullYear() + 10);
    });

    it("a code with a past expiresAt no longer appears in the snapshot", async () => {
      const { service, zoneRepo } = buildService();
      const zone = await zoneRepo.create({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
      const created = await service.create({ employeeName: "Temporaire", zoneIds: [zone.id], expiresAt: new Date(Date.now() - 60_000), createdBy: userId });

      const grants = await service.findActiveGrantsForZoneIds([zone.id]);
      expect(grants).toHaveLength(0);

      // Nettoyage best-effort : le statut passe à EXPIRED (même logique que les commandes).
      const list = await service.listActive();
      expect(list.find((c) => c.id === created.id)).toBeUndefined();
    });
  });
});
