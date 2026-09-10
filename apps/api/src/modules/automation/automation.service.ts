import { createHash } from "node:crypto";
import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import { generateOpaqueToken, hashToken } from "../identity/tokens.js";
import { decryptAccessCode } from "../access/access-code-crypto.js";
import type { AccessGrantRepository } from "../access/access-grant.repository.js";
import type { AutomationDeviceRepository } from "./automation-device.repository.js";
import type { ZoneRepository } from "./zone.repository.js";
import type { LightScheduleRepository } from "./light-schedule.repository.js";
import { mergeLightIntervals } from "./light-interval-merger.js";

export interface RegisterDeviceInput {
  name: string;
}

export interface HeartbeatInput {
  uptimeSeconds?: number;
  nanoConnected?: boolean;
  logoReachable?: boolean;
  dbOk?: boolean;
  pendingEvents?: number;
  softwareVersion?: string;
}

export interface ReportedEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  payload?: unknown;
}

interface SnapshotBody {
  revision: string;
  generatedAt: string;
  zones: Array<{ key: string; type: string; label: string; courtId: string | null }>;
  grants: Array<{ scope: string; code: string; origin: string; validFrom: string; validUntil: string }>;
  lightIntervals: Array<{ zoneKey: string; startsAt: string; endsAt: string }>;
  commands: Array<{ id: string; zoneKey: string; type: string }>;
}

export interface SnapshotResult {
  notModified: boolean;
  revision?: string;
  body?: SnapshotBody;
}

const DEFAULT_SNAPSHOT_WINDOW_BEFORE_HOURS = 2;
const DEFAULT_SNAPSHOT_WINDOW_AFTER_HOURS = 48;

/**
 * Phase 1 (CDC automatisation, rollout progressif) : "données uniquement —
 * grants, zones, snapshot, aucune action physique". Ce service ne pilote
 * jamais de matériel — il expose au Raspberry ce dont il a besoin pour
 * décider localement (dossier technique §40 : validation locale, jamais
 * d'appel serveur au moment de la saisie du code).
 */
export class AutomationService {
  constructor(
    private readonly deviceRepo: AutomationDeviceRepository,
    private readonly zoneRepo: ZoneRepository,
    private readonly grantRepo: AccessGrantRepository,
    private readonly lightScheduleRepo: LightScheduleRepository,
    private readonly config: AppConfig,
  ) {}

  async registerDevice(input: RegisterDeviceInput): Promise<{ deviceId: string; deviceKey: string }> {
    const { raw, hash } = generateOpaqueToken();
    const device = await this.deviceRepo.create({ name: input.name, deviceKeyHash: hash });
    return { deviceId: device.id, deviceKey: raw };
  }

  async authenticate(rawDeviceKey: string) {
    const device = await this.deviceRepo.findByKeyHash(hashToken(rawDeviceKey));
    if (!device || device.status !== "ACTIVE") {
      throw new AppError(ErrorCodes.UNAUTHENTICATED, "Dispositif d'automatisation inconnu ou révoqué.", 401);
    }
    return device;
  }

  async revokeDevice(id: string) {
    await this.deviceRepo.revoke(id);
  }

  async listDevices() {
    return this.deviceRepo.listActive();
  }

  isOffline(lastSeenAt: Date | null): boolean {
    if (!lastSeenAt) return true;
    return Date.now() - lastSeenAt.getTime() > this.config.ACCESS_DEVICE_OFFLINE_THRESHOLD_MINUTES * 60_000;
  }

  async listZones() {
    return this.zoneRepo.listActive();
  }

  async createZone(input: { key: string; type: "DOOR" | "LIGHT" | "GENERIC"; label: string; courtId?: string }) {
    return this.zoneRepo.create({
      key: input.key,
      type: input.type,
      label: input.label,
      court: input.courtId ? { connect: { id: input.courtId } } : undefined,
    });
  }

  /** Commande MVP explicitement listée au CDC — jamais de commande bas niveau. */
  async queueCommand(zoneKey: string, type: "OPEN_DOOR_PULSE" | "LIGHT_OVERRIDE_ON" | "LIGHT_OVERRIDE_OFF" | "CLEAR_LIGHT_OVERRIDE", requestedBy: string) {
    const zone = await this.zoneRepo.findByKey(zoneKey);
    if (!zone) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Zone inconnue.", 404);
    }
    const expiresAt = new Date(Date.now() + this.config.ACCESS_COMMAND_TTL_MINUTES * 60_000);
    const command = await this.deviceRepo.createCommand({
      zone: { connect: { id: zone.id } },
      type,
      requestedBy,
      expiresAt,
    });
    logger.info({ event: "AutomationCommandQueued", zoneKey, type, commandId: command.id }, "commande d'automatisation mise en file");
    return command;
  }

  /**
   * ACK explicite du Raspberry (RASPBERRY_PROTOCOL.md §"Fiabilité des
   * commandes") — seule transition qui retire une commande du snapshot. Une
   * commande jamais ACKée reste redélivrée à chaque snapshot jusqu'à
   * expiration : le Raspberry garantit de son côté qu'un même `commandId`
   * n'est exécuté physiquement qu'une fois (idempotence locale), le serveur
   * ne le garantit jamais lui-même.
   */
  async ackCommand(commandId: string, deviceId: string): Promise<void> {
    const acked = await this.deviceRepo.ackCommand(commandId, deviceId);
    if (!acked) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Commande inconnue ou déjà acquittée/expirée.", 404);
    }
    logger.info({ event: "AutomationCommandAcked", commandId, deviceId }, "commande d'automatisation acquittée");
  }

  async recordHeartbeat(deviceId: string, revision: string | undefined, input: HeartbeatInput) {
    await this.deviceRepo.touchHeartbeat(deviceId, revision ?? "", JSON.parse(JSON.stringify(input)));
  }

  async recordEvents(deviceId: string, events: ReportedEvent[]) {
    const parsed = events.map((e) => ({ eventId: e.eventId, type: e.type, payload: e.payload, occurredAt: new Date(e.occurredAt) }));
    return this.deviceRepo.recordEvents(deviceId, parsed);
  }

  /**
   * Snapshot versionné (dossier technique §39) : ETag = hash déterministe du
   * contenu réellement exposé (zones, grants, intervalles lumière,
   * commandes éligibles) — jamais un compteur en mémoire, donc correct même
   * après reboot du serveur. Une commande DELIVERED non ACKée fait partie du
   * hash au même titre qu'une commande PENDING (son id/type y figurent tant
   * qu'elle n'est pas ACKée) : un Raspberry qui revient avec un ETag périmé
   * (nouvelle commande apparue, ou commande retirée après ACK) ne reçoit
   * donc jamais un 304 à tort.
   *
   * Les grants d'une zone sont rapprochés par `booking.courtId` (grants
   * V2_GENERATED) ET par le nom du terrain (`Court.name`, grants
   * LEGACY_IMPORTED : `AccessGrantService.provisionOrImportForBooking`
   * utilise `playgroundName` — le libellé Doinsport, pas l'UUID V2 — comme
   * `scope` quand Legacy l'a fourni). Ignorer cette deuxième correspondance
   * ferait silencieusement disparaître tous les codes Legacy importés du
   * snapshot alors qu'ils existent bien en base.
   */
  async buildSnapshot(deviceId: string, ifNoneMatch: string | undefined): Promise<SnapshotResult> {
    await this.deviceRepo.expireStaleCommands();

    const zones = await this.zoneRepo.listActive();
    const now = new Date();
    const from = new Date(now.getTime() - DEFAULT_SNAPSHOT_WINDOW_BEFORE_HOURS * 3_600_000);
    const to = new Date(now.getTime() + DEFAULT_SNAPSHOT_WINDOW_AFTER_HOURS * 3_600_000);

    const grantScopes = new Set<string>();
    for (const z of zones) {
      grantScopes.add(z.key);
      if (z.courtId) grantScopes.add(z.courtId);
      if (z.court?.name) grantScopes.add(z.court.name);
    }
    const grants = grantScopes.size > 0 ? await this.grantRepo.findActiveInScopesWindow([...grantScopes], from, to) : [];

    const lightIntervals: SnapshotBody["lightIntervals"] = [];
    for (const zone of zones) {
      if (zone.type !== "LIGHT" || !zone.courtId) continue;
      const windows = await this.lightScheduleRepo.findOccupiedWindowsForCourt(zone.courtId, from, to);
      const padded = windows.map((w) => ({
        start: new Date(w.start.getTime() - this.config.LIGHT_ENABLED_BEFORE_MINUTES * 60_000),
        end: new Date(w.end.getTime() + this.config.LIGHT_ENABLED_AFTER_MINUTES * 60_000),
      }));
      for (const interval of mergeLightIntervals(padded)) {
        lightIntervals.push({ zoneKey: zone.key, ...interval });
      }
    }

    const zoneIds = zones.map((z) => z.id);
    const deliverableCommands = zoneIds.length > 0 ? await this.deviceRepo.findDeliverableCommands(zoneIds) : [];
    const zoneById = new Map(zones.map((z) => [z.id, z]));

    const zonesOut = zones.map((z) => ({ key: z.key, type: z.type, label: z.label, courtId: z.courtId }));
    const grantsOut = grants.map((g) => ({
      scope: g.scope,
      code: decryptAccessCode(this.config, g.codeCiphertext, g.codeIv),
      origin: g.origin,
      validFrom: g.validFrom.toISOString(),
      validUntil: g.validUntil.toISOString(),
    }));
    const commandsOut = deliverableCommands.map((c) => ({ id: c.id, zoneKey: zoneById.get(c.zoneId)?.key ?? c.zoneId, type: c.type }));

    const revision = createHash("sha256")
      .update(JSON.stringify({ zones: zonesOut, grants: grantsOut, lightIntervals, commands: commandsOut }))
      .digest("hex");

    if (ifNoneMatch === revision) {
      return { notModified: true, revision };
    }

    // Le contenu diffère de ce que le device avait en cache : on livre
    // vraiment cette réponse, donc c'est ici (et seulement ici) que les
    // commandes encore PENDING passent DELIVERED — jamais sur un 304.
    const newlyPending = deliverableCommands.filter((c) => c.status === "PENDING").map((c) => c.id);
    await this.deviceRepo.markDelivered(newlyPending, deviceId);

    return {
      notModified: false,
      revision,
      body: { revision, generatedAt: now.toISOString(), zones: zonesOut, grants: grantsOut, lightIntervals, commands: commandsOut },
    };
  }
}
