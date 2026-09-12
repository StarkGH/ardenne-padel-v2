import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import { decryptAccessCode, encryptAccessCode, generateRandomAccessCode } from "../access/access-code-crypto.js";
import type { StaffAccessCodeRepository } from "./staff-access-code.repository.js";
import type { ZoneRepository } from "./zone.repository.js";

const MAX_CODE_GENERATION_ATTEMPTS = 20;

export interface StaffAccessCodeView {
  id: string;
  employeeName: string;
  code: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
  zones: Array<{ id: string; key: string; label: string }>;
}

/**
 * Codes maîtres employés (nominatifs, zone par zone, expiration optionnelle
 * — décisions confirmées explicitement, pas une supposition). Jamais lié à
 * une réservation, contrairement à `AccessGrant` (module `access`) : cycle
 * de vie propre, géré uniquement par l'admin.
 *
 * Anti-collision volontairement limité aux autres codes maîtres actifs
 * partageant une zone (pas aux `AccessGrant` liés à des réservations, dont
 * la fenêtre de validité est temporaire) : un code maître est permanent, le
 * vérifier contre l'historique complet des grants de réservation
 * demanderait une requête sans borne temporelle sur toutes les zones —
 * risque résiduel documenté plutôt qu'ignoré silencieusement : si un code
 * maître partage exactement la même valeur qu'un code de réservation actif
 * sur la même zone, les deux ouvrent la porte (aucune faille de sécurité),
 * seule l'attribution exacte d'un événement d'accès dans l'historique
 * pourrait être ambiguë entre les deux identités.
 */
export class StaffAccessCodeService {
  constructor(
    private readonly repo: StaffAccessCodeRepository,
    private readonly zoneRepo: ZoneRepository,
    private readonly config: AppConfig,
  ) {}

  async create(input: { employeeName: string; zoneIds: string[]; expiresAt?: Date; createdBy: string }): Promise<StaffAccessCodeView> {
    if (input.zoneIds.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Au moins une zone est requise.", 422);
    }
    const zones = await this.zoneRepo.listActive();
    const targetZones = zones.filter((z) => input.zoneIds.includes(z.id));
    if (targetZones.length !== input.zoneIds.length) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Une ou plusieurs zones sont inconnues.", 404);
    }

    const existingOnSameZones = await this.repo.findActiveForZoneIds(input.zoneIds);
    let code: string | undefined;
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
      const candidate = generateRandomAccessCode();
      const collides = existingOnSameZones.some((c) => decryptAccessCode(this.config, c.codeCiphertext, c.codeIv) === candidate);
      if (!collides) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Impossible de générer un code sans collision sur ces zones.", 409);
    }

    const { ciphertext, iv } = encryptAccessCode(this.config, code);
    const created = await this.repo.create({
      employeeName: input.employeeName,
      codeCiphertext: ciphertext,
      codeIv: iv,
      expiresAt: input.expiresAt,
      createdBy: input.createdBy,
      zones: { create: targetZones.map((z) => ({ zone: { connect: { id: z.id } } })) },
    });
    logger.info({ event: "StaffAccessCodeCreated", codeId: created.id, employeeName: input.employeeName, zoneIds: input.zoneIds }, "code maître employé créé");

    return this.toView(created, code);
  }

  async revoke(id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Code maître inconnu.", 404);
    }
    await this.repo.revoke(id);
    logger.info({ event: "StaffAccessCodeRevoked", codeId: id }, "code maître employé révoqué");
  }

  async listActive(): Promise<StaffAccessCodeView[]> {
    const codes = await this.repo.listActive();
    return codes.map((c) => this.toView(c, decryptAccessCode(this.config, c.codeCiphertext, c.codeIv)));
  }

  /** Snapshot device — un "grant" par zone assignée, jamais un scope "ALL" implicite (CDC : zone par zone). */
  async findActiveGrantsForZoneIds(zoneIds: string[]): Promise<Array<{ scope: string; code: string; validFrom: Date; validUntil: Date }>> {
    if (zoneIds.length === 0) return [];
    await this.repo.expireStale();
    const codes = await this.repo.findActiveForZoneIds(zoneIds);
    const farFuture = new Date("2099-01-01T00:00:00.000Z");
    const out: Array<{ scope: string; code: string; validFrom: Date; validUntil: Date }> = [];
    for (const c of codes) {
      const code = decryptAccessCode(this.config, c.codeCiphertext, c.codeIv);
      for (const z of c.zones) {
        if (!zoneIds.includes(z.zoneId)) continue;
        out.push({ scope: z.zone.key, code, validFrom: c.createdAt, validUntil: c.expiresAt ?? farFuture });
      }
    }
    return out;
  }

  private toView(
    code: { id: string; employeeName: string; status: string; expiresAt: Date | null; createdAt: Date; zones: Array<{ zone: { id: string; key: string; label: string } }> },
    plainCode: string,
  ): StaffAccessCodeView {
    return {
      id: code.id,
      employeeName: code.employeeName,
      code: plainCode,
      status: code.status,
      expiresAt: code.expiresAt,
      createdAt: code.createdAt,
      zones: code.zones.map((z) => ({ id: z.zone.id, key: z.zone.key, label: z.zone.label })),
    };
  }
}
