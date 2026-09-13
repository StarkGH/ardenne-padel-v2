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
import type { StaffAccessCodeService } from "./staff-access-code.service.js";
import type { DoinsportAccessCodeRepository } from "./doinsport-access-code.repository.js";

export type ManualCommandType = "DOOR_OPEN" | "DOOR_CLOSE" | "LIGHT_ON" | "LIGHT_OFF";
/** Vocabulaire complet accepté par `AccessCommand.type` — identique aux commandes manuelles pour l'instant (aucune commande automatisée n'existe encore réellement). */
export type CommandType = ManualCommandType;

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
  commands: Array<{ id: string; zoneKey: string | null; type: string; createdAt: string; expiresAt: string }>;
}

export interface SnapshotResult {
  notModified: boolean;
  revision?: string;
  body?: SnapshotBody;
}

export interface CommandPublicView {
  id: string;
  deviceId: string | null;
  zoneKey: string | null;
  type: string;
  status: string;
  requestedBy: string | null;
  result: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
  ackedAt: Date | null;
  expiresAt: Date;
}

const DEFAULT_SNAPSHOT_WINDOW_BEFORE_HOURS = 2;
const DEFAULT_SNAPSHOT_WINDOW_AFTER_HOURS = 48;

/**
 * Phase 1 (CDC automatisation, rollout progressif) + commandes manuelles
 * (CDC_APV2_COMMANDES_MANUELLES_RASPBERRY_LOGO). Ce service ne pilote jamais
 * de matériel — il expose au Raspberry ce dont il a besoin pour décider/agir
 * localement (dossier technique §40 : validation locale, jamais d'appel
 * serveur au moment de la saisie du code ; §36/§37 : aucune adresse Modbus
 * ni mapping LOGO! ne transite jamais par AP V2).
 */
export class AutomationService {
  constructor(
    private readonly deviceRepo: AutomationDeviceRepository,
    private readonly zoneRepo: ZoneRepository,
    private readonly grantRepo: AccessGrantRepository,
    private readonly lightScheduleRepo: LightScheduleRepository,
    private readonly staffAccessCodeService: StaffAccessCodeService,
    private readonly doinsportAccessCodeRepo: DoinsportAccessCodeRepository,
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

  /**
   * Seuil unique en ligne/hors ligne (CDC_APV2_COMMANDES_MANUELLES_RASPBERRY_LOGO
   * §4/§5) : sert à la fois au badge admin et au refus des commandes
   * manuelles — jamais deux définitions divergentes de "en ligne".
   */
  isOffline(lastSeenAt: Date | null): boolean {
    if (!lastSeenAt) return true;
    return Date.now() - lastSeenAt.getTime() > this.config.AUTOMATION_DEVICE_OFFLINE_AFTER_SECONDS * 1000;
  }

  async listZones() {
    return this.zoneRepo.listActive();
  }

  async createZone(input: {
    key: string;
    type: "DOOR" | "LIGHT" | "GENERIC";
    label: string;
    courtId?: string;
    doorBeforeMinutes?: number;
    doorAfterMinutes?: number;
    lightBeforeMinutes?: number;
    lightAfterMinutes?: number;
  }) {
    return this.zoneRepo.create({
      key: input.key,
      type: input.type,
      label: input.label,
      court: input.courtId ? { connect: { id: input.courtId } } : undefined,
      doorBeforeMinutes: input.doorBeforeMinutes,
      doorAfterMinutes: input.doorAfterMinutes,
      lightBeforeMinutes: input.lightBeforeMinutes,
      lightAfterMinutes: input.lightAfterMinutes,
    });
  }

  /**
   * Édite les marges avant/après d'une zone existante (CDC : "configurer
   * dans l'interface X minutes avant/après par terrain", porte et éclairage
   * séparément). `undefined` = ne touche pas le champ ; `null` explicite =
   * revient à la marge globale.
   */
  async updateZoneMargins(
    zoneId: string,
    input: { doorBeforeMinutes?: number | null; doorAfterMinutes?: number | null; lightBeforeMinutes?: number | null; lightAfterMinutes?: number | null },
  ) {
    const zone = await this.zoneRepo.findById(zoneId);
    if (!zone) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Zone inconnue.", 404);
    }
    return this.zoneRepo.update(zoneId, {
      ...(input.doorBeforeMinutes !== undefined && { doorBeforeMinutes: input.doorBeforeMinutes }),
      ...(input.doorAfterMinutes !== undefined && { doorAfterMinutes: input.doorAfterMinutes }),
      ...(input.lightBeforeMinutes !== undefined && { lightBeforeMinutes: input.lightBeforeMinutes }),
      ...(input.lightAfterMinutes !== undefined && { lightAfterMinutes: input.lightAfterMinutes }),
    });
  }

  /** Commande MVP zone-scopée (future automatisation planifiée) — jamais de commande bas niveau. */
  async queueCommand(zoneKey: string, type: CommandType, requestedBy: string) {
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
   * Commande manuelle depuis le back-office (CDC_APV2_COMMANDES_MANUELLES_RASPBERRY_LOGO
   * §3/§5/§11/§21) : cible directement un device (pas de zone), refusée si le
   * device est hors ligne ou déjà porteur d'une commande manuelle en vol
   * (anti-double-clic côté serveur — ne jamais faire confiance au seul bouton
   * frontend désactivé), expire rapidement (`MANUAL_COMMAND_TTL_SECONDS`,
   * 30 s par défaut) pour ne jamais s'exécuter tardivement après un retour en
   * ligne du Raspberry.
   */
  async queueManualCommand(deviceId: string, type: ManualCommandType, requestedBy: string): Promise<CommandPublicView> {
    const device = await this.deviceRepo.findById(deviceId);
    if (!device || device.status !== "ACTIVE") {
      throw new AppError(ErrorCodes.DEVICE_NOT_FOUND, "Dispositif d'automatisation introuvable.", 404);
    }
    if (this.isOffline(device.lastSeenAt)) {
      throw new AppError(ErrorCodes.AUTOMATION_DEVICE_OFFLINE, "Commandes indisponibles : Raspberry hors ligne.", 409);
    }
    const inFlight = await this.deviceRepo.findActivePendingCommandForDevice(deviceId);
    if (inFlight) {
      throw new AppError(ErrorCodes.COMMAND_ALREADY_PENDING, "Une commande manuelle est déjà en cours pour ce dispositif.", 409);
    }

    const expiresAt = new Date(Date.now() + this.config.MANUAL_COMMAND_TTL_SECONDS * 1000);
    const command = await this.deviceRepo.createCommand({
      device: { connect: { id: deviceId } },
      type,
      requestedBy,
      expiresAt,
    });
    logger.info({ event: "AutomationManualCommandQueued", deviceId, type, commandId: command.id, requestedBy }, "commande manuelle mise en file");
    return this.toPublicView(command, null);
  }

  async getCommand(commandId: string): Promise<CommandPublicView> {
    const command = await this.deviceRepo.findCommandById(commandId);
    if (!command) {
      throw new AppError(ErrorCodes.COMMAND_NOT_FOUND, "Commande inconnue.", 404);
    }
    const zoneKey = command.zoneId ? await this.zoneKeyFor(command.zoneId) : null;
    return this.toPublicView(command, zoneKey);
  }

  async listRecentCommandsForDevice(deviceId: string, limit: number): Promise<CommandPublicView[]> {
    const commands = await this.deviceRepo.findRecentCommandsForDevice(deviceId, limit);
    const zones = await this.zoneRepo.listActive();
    const zoneById = new Map(zones.map((z) => [z.id, z.key]));
    return commands.map((c) => this.toPublicView(c, c.zoneId ? (zoneById.get(c.zoneId) ?? c.zoneId) : null));
  }

  private async zoneKeyFor(zoneId: string): Promise<string> {
    const zones = await this.zoneRepo.listActive();
    return zones.find((z) => z.id === zoneId)?.key ?? zoneId;
  }

  private toPublicView(
    command: { id: string; deviceId: string | null; zoneId: string | null; type: string; status: string; requestedBy: string | null; result: string | null; createdAt: Date; deliveredAt: Date | null; ackedAt: Date | null; expiresAt: Date },
    zoneKey: string | null,
  ): CommandPublicView {
    return {
      id: command.id,
      deviceId: command.deviceId,
      zoneKey,
      type: command.type,
      status: command.status,
      requestedBy: command.requestedBy,
      result: command.result,
      createdAt: command.createdAt,
      deliveredAt: command.deliveredAt,
      ackedAt: command.ackedAt,
      expiresAt: command.expiresAt,
    };
  }

  /**
   * ACK explicite du Raspberry (RASPBERRY_PROTOCOL.md §"Fiabilité des
   * commandes") — seule transition qui retire une commande du snapshot. Une
   * commande jamais ACKée reste redélivrée à chaque snapshot jusqu'à
   * expiration : le Raspberry garantit de son côté qu'un même `commandId`
   * n'est exécuté physiquement qu'une fois (idempotence locale), le serveur
   * ne le garantit jamais lui-même. `status`/`result` distinguent le cycle
   * de la commande (traitée ou non) de l'issue physique réelle (CDC
   * §15 : un ACK "SUCCESS" ne prouve jamais un état physique, seulement que
   * le Raspberry a correctement transmis l'ordre au LOGO!).
   */
  async ackCommand(commandId: string, deviceId: string, status: "SUCCESS" | "FAILED", result: string | null): Promise<void> {
    const acked = await this.deviceRepo.ackCommand(commandId, deviceId, status, result);
    if (!acked) {
      const existing = await this.deviceRepo.findCommandById(commandId);
      if (!existing) throw new AppError(ErrorCodes.COMMAND_NOT_FOUND, "Commande inconnue.", 404);
      if (existing.status === "EXPIRED") throw new AppError(ErrorCodes.COMMAND_EXPIRED, "Commande expirée avant réception de l'ACK.", 404);
      throw new AppError(ErrorCodes.COMMAND_NOT_FOUND, "Commande déjà acquittée ou jamais livrée.", 404);
    }
    logger.info({ event: "AutomationCommandAcked", commandId, deviceId, status }, "commande d'automatisation acquittée");
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
   *
   * Les commandes manuelles ciblent directement `deviceId` (pas de zone) —
   * `findDeliverableCommands` renvoie donc l'union des commandes de zone du
   * device (`zoneId` parmi les zones actives) et de ses commandes device-only.
   *
   * Les réservations purement Doinsport (jamais passées par le checkout V2,
   * demande explicite du 2026-09-12) sont fusionnées ici aussi
   * (`DoinsportAccessCodeRepository`, origin `LEGACY_ONLY`), avec exclusion
   * de toute réservation déjà couverte par un `AccessGrant` Dual Run — le
   * Raspberry ne doit jamais voir deux fois le même code sous deux origines.
   * Une annulation côté Doinsport retire le code du prochain snapshot dès
   * que la synchro Legacy l'a marquée `canceled` (même mécanisme que les
   * réservations elles-mêmes, pas de logique de révocation séparée à
   * maintenir).
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
      const beforeMinutes = zone.lightBeforeMinutes ?? this.config.LIGHT_ENABLED_BEFORE_MINUTES;
      const afterMinutes = zone.lightAfterMinutes ?? this.config.LIGHT_ENABLED_AFTER_MINUTES;
      const padded = windows.map((w) => ({
        start: new Date(w.start.getTime() - beforeMinutes * 60_000),
        end: new Date(w.end.getTime() + afterMinutes * 60_000),
      }));
      for (const interval of mergeLightIntervals(padded)) {
        lightIntervals.push({ zoneKey: zone.key, ...interval });
      }
    }

    const zoneIds = zones.map((z) => z.id);
    const deliverableCommands = await this.deviceRepo.findDeliverableCommands(deviceId, zoneIds);
    const zoneById = new Map(zones.map((z) => [z.id, z]));

    const staffGrants = await this.staffAccessCodeService.findActiveGrantsForZoneIds(zoneIds);
    const doinsportOnlyGrants = await this.doinsportAccessCodeRepo.findActiveForScopesWindow(grantScopes, from, to);

    const zonesOut = zones.map((z) => ({ key: z.key, type: z.type, label: z.label, courtId: z.courtId }));
    const grantsOut = [
      ...grants.map((g) => ({
        scope: g.scope,
        code: decryptAccessCode(this.config, g.codeCiphertext, g.codeIv),
        origin: g.origin,
        validFrom: g.validFrom.toISOString(),
        validUntil: g.validUntil.toISOString(),
      })),
      ...staffGrants.map((g) => ({
        scope: g.scope,
        code: g.code,
        origin: "STAFF_MASTER",
        validFrom: g.validFrom.toISOString(),
        validUntil: g.validUntil.toISOString(),
      })),
      ...doinsportOnlyGrants.map((g) => ({
        scope: g.scope,
        code: g.code,
        origin: "LEGACY_ONLY",
        validFrom: g.validFrom.toISOString(),
        validUntil: g.validUntil.toISOString(),
      })),
    ];
    const commandsOut = deliverableCommands.map((c) => ({
      id: c.id,
      zoneKey: c.zoneId ? (zoneById.get(c.zoneId)?.key ?? c.zoneId) : null,
      type: c.type,
      createdAt: c.createdAt.toISOString(),
      expiresAt: c.expiresAt.toISOString(),
    }));

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

  /**
   * Vérification admin d'un code, sans matériel : rejoue exactement les
   * mêmes sources et fenêtres de validité que `buildSnapshot` (V2_GENERATED/
   * LEGACY_IMPORTED, STAFF_MASTER, LEGACY_ONLY), pour donner une réponse
   * fidèle à ce que le Raspberry validerait localement — utile pour tester
   * le circuit de bout en bout avant que le clavier physique soit câblé.
   */
  async testAccessCode(code: string): Promise<{ granted: boolean; scope?: string; origin?: string }> {
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
    const zoneIds = zones.map((z) => z.id);

    const grants = grantScopes.size > 0 ? await this.grantRepo.findActiveInScopesWindow([...grantScopes], from, to) : [];
    const staffGrants = await this.staffAccessCodeService.findActiveGrantsForZoneIds(zoneIds);
    const doinsportOnlyGrants = await this.doinsportAccessCodeRepo.findActiveForScopesWindow(grantScopes, from, to);

    const candidates = [
      ...grants.map((g) => ({
        scope: g.scope,
        code: decryptAccessCode(this.config, g.codeCiphertext, g.codeIv),
        origin: g.origin as string,
        validFrom: g.validFrom,
        validUntil: g.validUntil,
      })),
      ...staffGrants.map((g) => ({ scope: g.scope, code: g.code, origin: "STAFF_MASTER", validFrom: g.validFrom, validUntil: g.validUntil })),
      ...doinsportOnlyGrants.map((g) => ({ scope: g.scope, code: g.code, origin: "LEGACY_ONLY", validFrom: g.validFrom, validUntil: g.validUntil })),
    ];

    const match = candidates.find((c) => c.code === code && c.validFrom <= now && c.validUntil >= now);
    if (!match) return { granted: false };
    return { granted: true, scope: match.scope, origin: match.origin };
  }
}
