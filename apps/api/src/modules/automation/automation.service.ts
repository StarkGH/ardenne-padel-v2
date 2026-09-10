import { createHash } from "node:crypto";
import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import { generateOpaqueToken, hashToken } from "../identity/tokens.js";
import { decryptAccessCode } from "../access/access-code-crypto.js";
import type { AccessGrantRepository } from "../access/access-grant.repository.js";
import type { AutomationDeviceRepository } from "./automation-device.repository.js";
import type { ZoneRepository } from "./zone.repository.js";

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

export interface SnapshotResult {
  notModified: boolean;
  revision?: string;
  body?: {
    revision: string;
    generatedAt: string;
    zones: Array<{ key: string; type: string; label: string; courtId: string | null }>;
    grants: Array<{ scope: string; code: string; validFrom: string; validUntil: string }>;
    commands: Array<{ zoneKey: string; type: string; id: string }>;
  };
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

  async recordHeartbeat(deviceId: string, revision: string | undefined, input: HeartbeatInput) {
    await this.deviceRepo.touchHeartbeat(deviceId, revision ?? "", JSON.parse(JSON.stringify(input)));
  }

  async recordEvents(deviceId: string, events: ReportedEvent[]) {
    const parsed = events.map((e) => ({ eventId: e.eventId, type: e.type, payload: e.payload, occurredAt: new Date(e.occurredAt) }));
    return this.deviceRepo.recordEvents(deviceId, parsed);
  }

  /**
   * Snapshot versionné (dossier technique §39) : ETag = hash déterministe du
   * contenu, jamais un compteur en mémoire — donc correct même après reboot
   * du serveur. `ifNoneMatch` déclenche un 304 sans recalcul inutile côté
   * Raspberry.
   */
  async buildSnapshot(deviceId: string, ifNoneMatch: string | undefined): Promise<SnapshotResult> {
    const zones = await this.zoneRepo.listActive();
    const now = new Date();
    const from = new Date(now.getTime() - DEFAULT_SNAPSHOT_WINDOW_BEFORE_HOURS * 3_600_000);
    const to = new Date(now.getTime() + DEFAULT_SNAPSHOT_WINDOW_AFTER_HOURS * 3_600_000);

    const scopes = zones.map((z) => z.key);
    const grants = scopes.length > 0 ? await this.grantRepo.findActiveInScopesWindow(scopes, from, to) : [];
    const commands = await this.deviceRepo.pullPendingCommands(
      deviceId,
      zones.map((z) => z.id),
    );

    const zoneById = new Map(zones.map((z) => [z.id, z]));

    const body = {
      zones: zones.map((z) => ({ key: z.key, type: z.type, label: z.label, courtId: z.courtId })),
      grants: grants.map((g) => ({
        scope: g.scope,
        code: decryptAccessCode(this.config, g.codeCiphertext, g.codeIv),
        validFrom: g.validFrom.toISOString(),
        validUntil: g.validUntil.toISOString(),
      })),
      commands: commands.map((c) => ({ zoneKey: zoneById.get(c.zoneId)?.key ?? c.zoneId, type: c.type, id: c.id })),
    };

    // Les commandes livrées sont retirées du hash de contenu stable (zones/grants) :
    // elles ne doivent jamais bloquer un 304 sur le reste du snapshot, et sont de
    // toute façon consommées (pull unique) à chaque appel.
    const stableRevision = createHash("sha256")
      .update(JSON.stringify({ zones: body.zones, grants: body.grants }))
      .digest("hex");

    if (commands.length === 0 && ifNoneMatch === stableRevision) {
      return { notModified: true, revision: stableRevision };
    }

    return {
      notModified: false,
      revision: stableRevision,
      body: { revision: stableRevision, generatedAt: now.toISOString(), ...body },
    };
  }
}
