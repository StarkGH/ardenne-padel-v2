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
import { StaffAccessCodeRepository } from "./staff-access-code.repository.js";
import { StaffAccessCodeService } from "./staff-access-code.service.js";
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

  function buildService(overrides: Partial<ReturnType<typeof loadConfig>> = {}) {
    const config = { ...loadConfig(), ...overrides };
    const deviceRepo = new AutomationDeviceRepository(prisma);
    const zoneRepo = new ZoneRepository(prisma);
    const grantRepo = new AccessGrantRepository(prisma);
    const lightScheduleRepo = new LightScheduleRepository(prisma);
    const staffAccessCodeService = new StaffAccessCodeService(new StaffAccessCodeRepository(prisma), zoneRepo, config);
    const service = new AutomationService(deviceRepo, zoneRepo, grantRepo, lightScheduleRepo, staffAccessCodeService, config);
    const accessGrantService = new AccessGrantService(grantRepo, new LocalAccessProvider(), {
      ...config,
      V2_ACCESS_ENABLED: true,
      LEGACY_ACCESS_IMPORT_ENABLED: true,
    });
    return { service, accessGrantService, staffAccessCodeService, config };
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

      const command = await service.queueCommand("main_entry", "DOOR_OPEN", userId);
      expect(command.status).toBe("PENDING");

      // GET #1 : la commande est livrée (PENDING -> DELIVERED).
      const first = await service.buildSnapshot(deviceId, undefined);
      expect(first.body!.commands).toHaveLength(1);
      expect(first.body!.commands[0]).toMatchObject({ zoneKey: zone.key, type: "DOOR_OPEN", id: command.id });

      // GET #2, sans ACK : simule un Raspberry qui a planté avant ouverture — la
      // commande doit rester récupérable, jamais perdue.
      const second = await service.buildSnapshot(deviceId, undefined);
      expect(second.body!.commands).toHaveLength(1);
      expect(second.body!.commands[0]!.id).toBe(command.id);

      // ACK explicite du Raspberry.
      await service.ackCommand(command.id, deviceId, "SUCCESS", "SUCCESS");

      // GET #3, après ACK : la commande a disparu, définitivement.
      const third = await service.buildSnapshot(deviceId, undefined);
      expect(third.body!.commands).toHaveLength(0);
    });

    it("rejects an ACK for a command that was never delivered", async () => {
      const { service } = buildService();
      await service.createZone({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
      const { deviceId } = await service.registerDevice({ name: "Raspberry ack invalide" });
      const command = await service.queueCommand("main_entry", "DOOR_OPEN", userId);

      // Jamais livrée (aucun buildSnapshot appelé) : encore PENDING, pas DELIVERED.
      await expect(service.ackCommand(command.id, deviceId, "SUCCESS", "SUCCESS")).rejects.toThrow();
    });

    it("rejects a second ACK on an already-acked command (no double-credit)", async () => {
      const { service } = buildService();
      await service.createZone({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
      const { deviceId } = await service.registerDevice({ name: "Raspberry double ack" });
      const command = await service.queueCommand("main_entry", "DOOR_OPEN", userId);
      await service.buildSnapshot(deviceId, undefined);

      await service.ackCommand(command.id, deviceId, "SUCCESS", "SUCCESS");
      await expect(service.ackCommand(command.id, deviceId, "SUCCESS", "SUCCESS")).rejects.toThrow();
    });

    it("rejects a command for an unknown zone", async () => {
      const { service } = buildService();
      await expect(service.queueCommand("zone-inconnue", "DOOR_OPEN", userId)).rejects.toThrow();
    });
  });

  describe("invalidation de l'ETag/revision", () => {
    it("invalidates the ETag as soon as a new command is queued", async () => {
      const { service } = buildService();
      await service.createZone({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
      const { deviceId } = await service.registerDevice({ name: "Raspberry etag commande" });

      const before = await service.buildSnapshot(deviceId, undefined);
      expect(before.body!.commands).toHaveLength(0);

      await service.queueCommand("main_entry", "DOOR_OPEN", userId);

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
      const command = await service.queueCommand("main_entry", "DOOR_OPEN", userId);

      const withCommand = await service.buildSnapshot(deviceId, undefined);
      expect(withCommand.body!.commands).toHaveLength(1);

      await service.ackCommand(command.id, deviceId, "SUCCESS", "SUCCESS");

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

    /** Demande explicite : marges configurables par terrain dans l'interface, pas seulement globalement. */
    it("uses a zone's own margin override instead of the global config when set", async () => {
      const { service } = buildService();
      const zone = await service.createZone({
        key: `light-override-${courtId}`,
        type: "LIGHT",
        label: "Éclairage terrain test (marge dédiée)",
        courtId,
        lightBeforeMinutes: 2,
        lightAfterMinutes: 3,
      });
      const { deviceId } = await service.registerDevice({ name: "Raspberry marge dédiée" });
      const booking = await createBookingRow(20, 0, 60);

      const snapshot = await service.buildSnapshot(deviceId, undefined);
      const interval = snapshot.body!.lightIntervals.find((i) => i.zoneKey === zone.key)!;

      expect(interval.startsAt).toBe(new Date(booking.startAt.getTime() - 2 * 60_000).toISOString());
      expect(interval.endsAt).toBe(new Date(booking.endAt.getTime() + 3 * 60_000).toISOString());
    });

    it("updateZoneMargins edits an existing zone's overrides, and null resets to the global default", async () => {
      const { service, config } = buildService();
      const zone = await service.createZone({ key: `light-edit-${courtId}`, type: "LIGHT", label: "Éclairage à éditer", courtId });
      const { deviceId } = await service.registerDevice({ name: "Raspberry édition marge" });
      const booking = await createBookingRow(21, 0, 60);

      await service.updateZoneMargins(zone.id, { lightBeforeMinutes: 1, lightAfterMinutes: 1 });
      const afterOverride = await service.buildSnapshot(deviceId, undefined);
      const overriddenInterval = afterOverride.body!.lightIntervals.find((i) => i.zoneKey === zone.key)!;
      expect(overriddenInterval.startsAt).toBe(new Date(booking.startAt.getTime() - 1 * 60_000).toISOString());

      await service.updateZoneMargins(zone.id, { lightBeforeMinutes: null });
      const afterReset = await service.buildSnapshot(deviceId, undefined);
      const resetInterval = afterReset.body!.lightIntervals.find((i) => i.zoneKey === zone.key)!;
      expect(resetInterval.startsAt).toBe(new Date(booking.startAt.getTime() - config.LIGHT_ENABLED_BEFORE_MINUTES * 60_000).toISOString());
    });

    it("rejects updateZoneMargins for an unknown zone", async () => {
      const { service } = buildService();
      await expect(service.updateZoneMargins("00000000-0000-0000-0000-000000000000", { lightBeforeMinutes: 1 })).rejects.toThrow();
    });
  });

  /** Codes maîtres employés — vérifie qu'ils atteignent réellement le snapshot device, avec `origin: STAFF_MASTER`, aux côtés des grants de réservation. */
  describe("codes maîtres dans le snapshot", () => {
    it("includes an active staff master code alongside booking grants, scoped to its own zone", async () => {
      const { service, staffAccessCodeService } = buildService();
      const doorZone = await service.createZone({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
      await service.createZone({ key: courtId, type: "GENERIC", label: "Terrain test", courtId });
      const { deviceId } = await service.registerDevice({ name: "Raspberry codes maîtres" });

      await staffAccessCodeService.create({ employeeName: "Dana Employée", zoneIds: [doorZone.id], createdBy: userId });

      const snapshot = await service.buildSnapshot(deviceId, undefined);
      const staffGrant = snapshot.body!.grants.find((g) => g.origin === "STAFF_MASTER");
      expect(staffGrant).toBeDefined();
      expect(staffGrant!.scope).toBe("main_entry");
      expect(staffGrant!.code).toMatch(/^\d{4}#$/);
      // N'apparaît jamais sur une autre zone que celle assignée (jamais universel).
      expect(snapshot.body!.grants.filter((g) => g.origin === "STAFF_MASTER")).toHaveLength(1);
    });
  });

  /**
   * CDC_APV2_COMMANDES_MANUELLES_RASPBERRY_LOGO §25 (tests obligatoires) —
   * commandes manuelles depuis l'admin, ciblant directement un device (pas
   * une zone), réutilisant le même lifecycle PENDING -> DELIVERED -> SUCCESS
   * /FAILED -> EXPIRED que les commandes zone-scopées.
   */
  describe("commandes manuelles (device-ciblées)", () => {
    async function registerOnlineDevice(service: AutomationService, name: string) {
      const { deviceId, deviceKey } = await service.registerDevice({ name });
      // Simule un heartbeat récent : sans ça, un device fraîchement enregistré
      // (lastSeenAt = null) est toujours considéré hors ligne.
      await service.recordHeartbeat(deviceId, "irrelevant", {});
      return { deviceId, deviceKey };
    }

    it("queues a manual command when the device is online, targeting the device directly (no zone)", async () => {
      const { service } = buildService();
      const { deviceId } = await registerOnlineDevice(service, "Raspberry manuel en ligne");

      const command = await service.queueManualCommand(deviceId, "DOOR_OPEN", userId);
      expect(command.status).toBe("PENDING");
      expect(command.deviceId).toBe(deviceId);
      expect(command.zoneKey).toBeNull();
      expect(command.requestedBy).toBe(userId);
    });

    it("refuses a manual command for a device that has never been seen (offline)", async () => {
      const { service } = buildService();
      const { deviceId } = await service.registerDevice({ name: "Raspberry jamais vu" });

      await expect(service.queueManualCommand(deviceId, "DOOR_OPEN", userId)).rejects.toMatchObject({ code: "AUTOMATION_DEVICE_OFFLINE", httpStatus: 409 });
    });

    it("refuses a manual command once the heartbeat is older than the offline threshold", async () => {
      // Seuil ramené à 0 s : le heartbeat qu'on vient d'envoyer est donc déjà "périmé".
      const { service } = buildService({ AUTOMATION_DEVICE_OFFLINE_AFTER_SECONDS: 0 });
      const { deviceId } = await registerOnlineDevice(service, "Raspberry juste hors seuil");

      await expect(service.queueManualCommand(deviceId, "DOOR_OPEN", userId)).rejects.toMatchObject({ code: "AUTOMATION_DEVICE_OFFLINE" });
    });

    it("refuses a manual command for an unknown device", async () => {
      const { service } = buildService();
      await expect(service.queueManualCommand("00000000-0000-0000-0000-000000000000", "DOOR_OPEN", userId)).rejects.toMatchObject({ code: "DEVICE_NOT_FOUND", httpStatus: 404 });
    });

    it("refuses a manual command for a revoked device", async () => {
      const { service } = buildService();
      const { deviceId } = await registerOnlineDevice(service, "Raspberry révoqué manuel");
      await service.revokeDevice(deviceId);

      await expect(service.queueManualCommand(deviceId, "DOOR_OPEN", userId)).rejects.toMatchObject({ code: "DEVICE_NOT_FOUND" });
    });

    it("anti-double-clic serveur : refuse une deuxième commande manuelle tant que la première n'est pas résolue", async () => {
      const { service } = buildService();
      const { deviceId } = await registerOnlineDevice(service, "Raspberry double clic");

      await service.queueManualCommand(deviceId, "DOOR_OPEN", userId);
      await expect(service.queueManualCommand(deviceId, "LIGHT_ON", userId)).rejects.toMatchObject({ code: "COMMAND_ALREADY_PENDING", httpStatus: 409 });
    });

    it("allows a new manual command once the previous one has been ACKed", async () => {
      const { service } = buildService();
      const { deviceId } = await registerOnlineDevice(service, "Raspberry enchaînement");

      const first = await service.queueManualCommand(deviceId, "DOOR_OPEN", userId);
      await service.buildSnapshot(deviceId, undefined); // livraison
      await service.ackCommand(first.id, deviceId, "SUCCESS", "SUCCESS");

      const second = await service.queueManualCommand(deviceId, "DOOR_CLOSE", userId);
      expect(second.status).toBe("PENDING");
    });

    it("delivers a manual command to its targeted device only, never to another device", async () => {
      const { service } = buildService();
      const { deviceId: deviceA } = await registerOnlineDevice(service, "Raspberry A");
      const { deviceId: deviceB } = await registerOnlineDevice(service, "Raspberry B");

      await service.queueManualCommand(deviceA, "LIGHT_ON", userId);

      const snapshotA = await service.buildSnapshot(deviceA, undefined);
      expect(snapshotA.body!.commands).toHaveLength(1);
      expect(snapshotA.body!.commands[0]).toMatchObject({ type: "LIGHT_ON", zoneKey: null });

      const snapshotB = await service.buildSnapshot(deviceB, undefined);
      expect(snapshotB.body!.commands).toHaveLength(0);
    });

    it("records a FAILED ACK with its error, distinct from SUCCESS", async () => {
      const { service } = buildService();
      const { deviceId } = await registerOnlineDevice(service, "Raspberry échec");
      const command = await service.queueManualCommand(deviceId, "DOOR_OPEN", userId);
      await service.buildSnapshot(deviceId, undefined);

      await service.ackCommand(command.id, deviceId, "FAILED", "LOGO_CONNECTION_FAILED");

      const view = await service.getCommand(command.id);
      expect(view.status).toBe("FAILED");
      expect(view.result).toBe("LOGO_CONNECTION_FAILED");
    });

    it("expires a manual command quickly (TTL court) and never delivers it late", async () => {
      const { service } = buildService({ MANUAL_COMMAND_TTL_SECONDS: -1 });
      const { deviceId } = await registerOnlineDevice(service, "Raspberry TTL court");

      const command = await service.queueManualCommand(deviceId, "DOOR_OPEN", userId);

      const snapshot = await service.buildSnapshot(deviceId, undefined);
      expect(snapshot.body!.commands).toHaveLength(0);

      const view = await service.getCommand(command.id);
      expect(view.status).toBe("EXPIRED");

      // Une commande expirée ne peut plus être ACKée tardivement.
      await expect(service.ackCommand(command.id, deviceId, "SUCCESS", "SUCCESS")).rejects.toMatchObject({ code: "COMMAND_EXPIRED" });
    });

    it("exposes createdAt/expiresAt so the Raspberry can enforce its own client-side deadline", async () => {
      const { service } = buildService();
      const { deviceId } = await registerOnlineDevice(service, "Raspberry timestamps");
      await service.queueManualCommand(deviceId, "DOOR_OPEN", userId);

      const snapshot = await service.buildSnapshot(deviceId, undefined);
      const cmd = snapshot.body!.commands[0]!;
      expect(new Date(cmd.createdAt).getTime()).toBeLessThanOrEqual(new Date(cmd.expiresAt).getTime());
    });

    it("lists the most recent commands for a device, newest first, for the admin history view", async () => {
      const { service } = buildService();
      const { deviceId } = await registerOnlineDevice(service, "Raspberry historique");

      const first = await service.queueManualCommand(deviceId, "LIGHT_ON", userId);
      await service.buildSnapshot(deviceId, undefined);
      await service.ackCommand(first.id, deviceId, "SUCCESS", "SUCCESS");
      const second = await service.queueManualCommand(deviceId, "LIGHT_OFF", userId);

      const history = await service.listRecentCommandsForDevice(deviceId, 20);
      expect(history.map((c) => c.id)).toEqual([second.id, first.id]);
      expect(history[1]!.status).toBe("SUCCESS");
    });

  });
});
