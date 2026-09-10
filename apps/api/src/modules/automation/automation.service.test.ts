import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, type Booking } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { AccessGrantRepository } from "../access/access-grant.repository.js";
import { AccessGrantService } from "../access/access-grant.service.js";
import { LocalAccessProvider } from "../access/local-access-provider.js";
import { AutomationDeviceRepository } from "./automation-device.repository.js";
import { ZoneRepository } from "./zone.repository.js";
import { LightScheduleRepository } from "./light-schedule.repository.js";
import { AutomationService } from "./automation.service.js";

/**
 * Automatisation physique (Raspberry), Phase 1 : authentification device,
 * snapshot versionné (ETag/304), fiabilité des commandes
 * (PENDING -> DELIVERED -> SUCCESS, jamais perdues avant ACK), intervalles
 * lumière fusionnés, remontée d'événements idempotente — contre une vraie
 * base, jamais de mock du domaine (même discipline que `AccessGrantService`).
 */
describe("AutomationService", () => {
  const prisma = new PrismaClient();
  let courtId: string;
  let courtName: string;
  let userId: string;

  beforeAll(async () => {
    resetConfigCacheForTests();
    const court = await prisma.court.upsert({
      where: { slug: "test-padel-automation" },
      update: {},
      create: { slug: "test-padel-automation", name: "Test Padel Automation", courtType: "DOUBLE", capacity: 4, displayOrder: 97 },
    });
    courtId = court.id;
    courtName = court.name;
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
    const lightScheduleRepo = new LightScheduleRepository(prisma);
    const service = new AutomationService(deviceRepo, zoneRepo, grantRepo, lightScheduleRepo, config);
    const accessGrantService = new AccessGrantService(grantRepo, new LocalAccessProvider(), {
      ...config,
      V2_ACCESS_ENABLED: true,
      LEGACY_ACCESS_IMPORT_ENABLED: true,
    });
    return { service, accessGrantService, config };
  }

  async function createBookingRow(hour: number, minute = 0, durationMinutes = 60): Promise<Booking> {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(hour, minute, 0, 0);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    return prisma.booking.create({
      data: {
        organizer: { connect: { id: userId } },
        court: { connect: { id: courtId } },
        startAt: start,
        endAt: end,
        durationMinutes,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "CONFIRMED",
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

  it("builds a snapshot containing zones/grants decrypted, and returns notModified on an unchanged ETag", async () => {
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
    expect(first.body!.grants[0]!.origin).toBe("V2_GENERATED");

    const second = await service.buildSnapshot(deviceId, first.revision);
    expect(second.notModified).toBe(true);
  });

  it("never uses grants outside the zones/scopes requested", async () => {
    const { service } = buildService();
    const { deviceId } = await service.registerDevice({ name: "Raspberry vide" });

    const snapshot = await service.buildSnapshot(deviceId, undefined);
    expect(snapshot.body!.zones).toHaveLength(0);
    expect(snapshot.body!.grants).toHaveLength(0);
  });

  /**
   * CDC §35/§78 : AccessGrantService.importLegacyGrant utilise le libellé
   * Doinsport (`playgroundName`) comme `scope`, pas l'UUID V2 du terrain —
   * contrairement aux grants V2_GENERATED. Une zone doit donc rapprocher les
   * grants par `courtId` ET par nom de terrain, sinon tous les codes Legacy
   * importés disparaîtraient silencieusement du snapshot.
   */
  it("routes both V2_GENERATED (matched by courtId) and LEGACY_IMPORTED (matched by court name) grants to the Raspberry", async () => {
    const { service, accessGrantService } = buildService();
    await service.createZone({ key: courtId, type: "GENERIC", label: "Terrain test", courtId });
    const { deviceId } = await service.registerDevice({ name: "Raspberry dual-run" });

    const v2Booking = await createBookingRow(9);
    await accessGrantService.provisionOrImportForBooking(v2Booking);

    const legacyBooking = await createBookingRow(11);
    await accessGrantService.provisionOrImportForBooking(legacyBooking, [{ code: "4242#", playgroundName: courtName }]);

    const snapshot = await service.buildSnapshot(deviceId, undefined);
    const origins = snapshot.body!.grants.map((g) => g.origin).sort();
    expect(origins).toEqual(["LEGACY_IMPORTED", "V2_GENERATED"]);
    const legacyGrant = snapshot.body!.grants.find((g) => g.origin === "LEGACY_IMPORTED");
    expect(legacyGrant?.code).toBe("4242#");
    expect(legacyGrant?.scope).toBe(courtName);
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

  describe("fiabilité des commandes (PENDING -> DELIVERED -> SUCCESS)", () => {
    it("redelivers a command on every poll until it is ACKed, then never again", async () => {
      const { service } = buildService();
      const zone = await service.createZone({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
      const { deviceId } = await service.registerDevice({ name: "Raspberry commandes" });

      const command = await service.queueCommand("main_entry", "OPEN_DOOR_PULSE", userId);
      expect(command.status).toBe("PENDING");

      // GET #1 : la commande est livrée (PENDING -> DELIVERED).
      const first = await service.buildSnapshot(deviceId, undefined);
      expect(first.body!.commands).toHaveLength(1);
      expect(first.body!.commands[0]).toMatchObject({ zoneKey: zone.key, type: "OPEN_DOOR_PULSE", id: command.id });

      // GET #2, sans ACK : simule un Raspberry qui a planté avant ouverture — la
      // commande doit rester récupérable, jamais perdue.
      const second = await service.buildSnapshot(deviceId, undefined);
      expect(second.body!.commands).toHaveLength(1);
      expect(second.body!.commands[0]!.id).toBe(command.id);

      // ACK explicite du Raspberry.
      await service.ackCommand(command.id, deviceId);

      // GET #3, après ACK : la commande a disparu, définitivement.
      const third = await service.buildSnapshot(deviceId, undefined);
      expect(third.body!.commands).toHaveLength(0);
    });

    it("rejects an ACK for a command that was never delivered", async () => {
      const { service } = buildService();
      await service.createZone({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
      const { deviceId } = await service.registerDevice({ name: "Raspberry ack invalide" });
      const command = await service.queueCommand("main_entry", "OPEN_DOOR_PULSE", userId);

      // Jamais livrée (aucun buildSnapshot appelé) : encore PENDING, pas DELIVERED.
      await expect(service.ackCommand(command.id, deviceId)).rejects.toThrow();
    });

    it("rejects a second ACK on an already-acked command (no double-credit)", async () => {
      const { service } = buildService();
      await service.createZone({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
      const { deviceId } = await service.registerDevice({ name: "Raspberry double ack" });
      const command = await service.queueCommand("main_entry", "OPEN_DOOR_PULSE", userId);
      await service.buildSnapshot(deviceId, undefined);

      await service.ackCommand(command.id, deviceId);
      await expect(service.ackCommand(command.id, deviceId)).rejects.toThrow();
    });

    it("rejects a command for an unknown zone", async () => {
      const { service } = buildService();
      await expect(service.queueCommand("zone-inconnue", "OPEN_DOOR_PULSE", userId)).rejects.toThrow();
    });
  });

  describe("invalidation de l'ETag/revision", () => {
    it("invalidates the ETag as soon as a new command is queued", async () => {
      const { service } = buildService();
      await service.createZone({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
      const { deviceId } = await service.registerDevice({ name: "Raspberry etag commande" });

      const before = await service.buildSnapshot(deviceId, undefined);
      expect(before.body!.commands).toHaveLength(0);

      await service.queueCommand("main_entry", "OPEN_DOOR_PULSE", userId);

      // Le Raspberry revient avec l'ETag précédent (aucune commande) : il ne doit
      // jamais recevoir un 304 alors qu'une commande l'attend désormais.
      const after = await service.buildSnapshot(deviceId, before.revision);
      expect(after.notModified).toBe(false);
      expect(after.revision).not.toBe(before.revision);
      expect(after.body!.commands).toHaveLength(1);
    });

    it("invalidates the ETag again once the command is ACKed (retrait du snapshot)", async () => {
      const { service } = buildService();
      await service.createZone({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
      const { deviceId } = await service.registerDevice({ name: "Raspberry etag ack" });
      const command = await service.queueCommand("main_entry", "OPEN_DOOR_PULSE", userId);

      const withCommand = await service.buildSnapshot(deviceId, undefined);
      expect(withCommand.body!.commands).toHaveLength(1);

      await service.ackCommand(command.id, deviceId);

      // Un Raspberry revenant avec l'ETag "commande présente" ne doit pas non
      // plus recevoir un 304 : le contenu réel (plus de commande) a changé.
      const afterAck = await service.buildSnapshot(deviceId, withCommand.revision);
      expect(afterAck.notModified).toBe(false);
      expect(afterAck.revision).not.toBe(withCommand.revision);
      expect(afterAck.body!.commands).toHaveLength(0);
    });
  });

  describe("éclairage (intervalles fusionnés)", () => {
    it("returns padded, merged light intervals for two consecutive bookings on the same court", async () => {
      const { service, config } = buildService();
      const zone = await service.createZone({ key: `light-${courtId}`, type: "LIGHT", label: "Éclairage terrain test", courtId });
      const { deviceId } = await service.registerDevice({ name: "Raspberry éclairage" });

      // Deux réservations consécutives, dos à dos : 18h-19h puis 19h-20h.
      const first = await createBookingRow(18, 0, 60);
      const second = await createBookingRow(19, 0, 60);

      const snapshot = await service.buildSnapshot(deviceId, undefined);
      const intervals = snapshot.body!.lightIntervals.filter((i) => i.zoneKey === zone.key);

      // Un seul intervalle fusionné, jamais deux (pas de flicker entre les deux créneaux).
      expect(intervals).toHaveLength(1);
      const expectedStart = new Date(first.startAt.getTime() - config.LIGHT_ENABLED_BEFORE_MINUTES * 60_000);
      const expectedEnd = new Date(second.endAt.getTime() + config.LIGHT_ENABLED_AFTER_MINUTES * 60_000);
      expect(intervals[0]!.startsAt).toBe(expectedStart.toISOString());
      expect(intervals[0]!.endsAt).toBe(expectedEnd.toISOString());
    });

    it("returns no light interval for a DOOR/GENERIC zone or a court with no booking", async () => {
      const { service } = buildService();
      await service.createZone({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
      const { deviceId } = await service.registerDevice({ name: "Raspberry sans réservation" });

      const snapshot = await service.buildSnapshot(deviceId, undefined);
      expect(snapshot.body!.lightIntervals).toHaveLength(0);
    });
  });
});
