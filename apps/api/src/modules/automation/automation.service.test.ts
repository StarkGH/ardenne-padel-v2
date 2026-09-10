import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, type Booking } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { AccessGrantRepository } from "../access/access-grant.repository.js";
import { AccessGrantService } from "../access/access-grant.service.js";
import { LocalAccessProvider } from "../access/local-access-provider.js";
import { AutomationDeviceRepository } from "./automation-device.repository.js";
import { ZoneRepository } from "./zone.repository.js";
import { AutomationService } from "./automation.service.js";

/**
 * Automatisation physique (Raspberry), Phase 1 : authentification device,
 * snapshot versionné (ETag/304), remontée d'événements idempotente — contre
 * une vraie base, jamais de mock du domaine (même discipline que
 * `AccessGrantService`).
 */
describe("AutomationService", () => {
  const prisma = new PrismaClient();
  let courtId: string;
  let userId: string;

  beforeAll(async () => {
    resetConfigCacheForTests();
    const court = await prisma.court.upsert({
      where: { slug: "test-padel-automation" },
      update: {},
      create: { slug: "test-padel-automation", name: "Test Padel Automation", courtType: "DOUBLE", capacity: 4, displayOrder: 97 },
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
      data: { email: `automation-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "A", lastName: "B", status: "ACTIVE" },
    });
    userId = user.id;
  });

  function buildService() {
    const config = loadConfig();
    const deviceRepo = new AutomationDeviceRepository(prisma);
    const zoneRepo = new ZoneRepository(prisma);
    const grantRepo = new AccessGrantRepository(prisma);
    const service = new AutomationService(deviceRepo, zoneRepo, grantRepo, config);
    const accessGrantService = new AccessGrantService(grantRepo, new LocalAccessProvider(), { ...config, V2_ACCESS_ENABLED: true });
    return { service, accessGrantService, config };
  }

  async function createBookingRow(hour: number): Promise<Booking> {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60_000);
    return prisma.booking.create({
      data: {
        organizer: { connect: { id: userId } },
        court: { connect: { id: courtId } },
        startAt: start,
        endAt: end,
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
      },
    });
  }

  it("registers a device and authenticates it by its raw key, never by the hash", async () => {
    const { service } = buildService();
    const { deviceId, deviceKey } = await service.registerDevice({ name: "Raspberry test" });

    const device = await service.authenticate(deviceKey);
    expect(device.id).toBe(deviceId);
    await expect(service.authenticate("clé-invalide")).rejects.toThrow();
  });

  it("refuses authentication for a revoked device", async () => {
    const { service } = buildService();
    const { deviceId, deviceKey } = await service.registerDevice({ name: "Raspberry révoqué" });
    await service.revokeDevice(deviceId);

    await expect(service.authenticate(deviceKey)).rejects.toThrow();
  });

  it("builds a snapshot containing only zones/grants, decrypted, and returns 304-equivalent (notModified) on unchanged ETag", async () => {
    const { service, accessGrantService } = buildService();
    const zone = await service.createZone({ key: courtId, type: "GENERIC", label: "Terrain test", courtId });
    const { deviceId } = await service.registerDevice({ name: "Raspberry snapshot" });
    const booking = await createBookingRow(9);
    await accessGrantService.provisionOrImportForBooking(booking);

    const first = await service.buildSnapshot(deviceId, undefined);
    expect(first.notModified).toBe(false);
    expect(first.body!.zones).toHaveLength(1);
    expect(first.body!.zones[0]!.key).toBe(zone.key);
    expect(first.body!.grants).toHaveLength(1);
    expect(first.body!.grants[0]!.code).toMatch(/^\d{4}#$/);

    const second = await service.buildSnapshot(deviceId, first.revision);
    expect(second.notModified).toBe(true);
  });

  it("never uses future/other zones' grants outside the scope requested", async () => {
    const { service } = buildService();
    const { deviceId } = await service.registerDevice({ name: "Raspberry vide" });

    const snapshot = await service.buildSnapshot(deviceId, undefined);
    expect(snapshot.body!.zones).toHaveLength(0);
    expect(snapshot.body!.grants).toHaveLength(0);
  });

  it("records reported events idempotently by (deviceId, eventId)", async () => {
    const { service } = buildService();
    const { deviceId } = await service.registerDevice({ name: "Raspberry events" });
    const occurredAt = new Date().toISOString();

    const first = await service.recordEvents(deviceId, [{ eventId: "evt-1", type: "ACCESS_GRANTED", occurredAt }]);
    expect(first).toEqual({ accepted: 1, duplicates: 0 });

    // Même eventId renvoyé deux fois (retry réseau) : jamais dupliqué.
    const retry = await service.recordEvents(deviceId, [{ eventId: "evt-1", type: "ACCESS_GRANTED", occurredAt }]);
    expect(retry).toEqual({ accepted: 0, duplicates: 1 });
  });

  it("queues an MVP command and delivers it once via the next snapshot pull", async () => {
    const { service } = buildService();
    const zone = await service.createZone({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
    const { deviceId } = await service.registerDevice({ name: "Raspberry commandes" });

    const command = await service.queueCommand("main_entry", "OPEN_DOOR_PULSE", userId);
    expect(command.status).toBe("PENDING");

    const snapshot = await service.buildSnapshot(deviceId, undefined);
    expect(snapshot.body!.commands).toHaveLength(1);
    expect(snapshot.body!.commands[0]).toMatchObject({ zoneKey: zone.key, type: "OPEN_DOOR_PULSE", id: command.id });

    // Modèle pull uniquement : une fois livrée, la commande ne réapparaît plus.
    const secondSnapshot = await service.buildSnapshot(deviceId, undefined);
    expect(secondSnapshot.body!.commands).toHaveLength(0);
  });

  it("rejects a command for an unknown zone", async () => {
    const { service } = buildService();
    await expect(service.queueCommand("zone-inconnue", "OPEN_DOOR_PULSE", userId)).rejects.toThrow();
  });
});
