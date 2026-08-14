import { logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import type { Booking } from "@prisma/client";
import { decryptAccessCode, encryptAccessCode, generateRandomAccessCode } from "./access-code-crypto.js";
import type { AccessProvider } from "./access-provider.js";
import type { AccessGrantRepository } from "./access-grant.repository.js";

export interface LegacyAccessCodeInput {
  code?: string;
  playgroundName?: string;
}

const MAX_CODE_GENERATION_ATTEMPTS = 20;

/**
 * CDC §34, §35, §36 — génération/révocation des codes d'accès V2, coexistence
 * avec les codes Legacy pendant Dual Run, et point d'entrée du module
 * `Automation` (§36) : appelée depuis les points de convergence
 * `BookingConfirmed`/`BookingCanceled` de `CheckoutService`/`SplitCheckoutService`/
 * `BookingsService`, jamais depuis le domaine Booking lui-même.
 */
export class AccessGrantService {
  constructor(
    private readonly repo: AccessGrantRepository,
    private readonly provider: AccessProvider,
    private readonly config: AppConfig,
  ) {}

  /**
   * Point d'entrée unique appelé après confirmation d'une réservation. CDC
   * §35/§78 : si Legacy a déjà attribué un ou plusieurs codes à cette
   * réservation (parce qu'elle a été créée/synchronisée côté Doinsport), on
   * les importe tels quels — on ne génère jamais un code V2 concurrent pour
   * la même réservation.
   */
  async provisionOrImportForBooking(booking: Booking, legacyAccessCodes?: LegacyAccessCodeInput[]): Promise<void> {
    if (!this.config.V2_ACCESS_ENABLED) return;

    const validLegacyCodes: Array<{ code: string; playgroundName?: string }> = [];
    for (const c of legacyAccessCodes ?? []) {
      if (c.code) validLegacyCodes.push({ code: c.code, playgroundName: c.playgroundName });
    }
    if (this.config.LEGACY_ACCESS_IMPORT_ENABLED && validLegacyCodes.length > 0) {
      for (const legacyCode of validLegacyCodes) {
        await this.importLegacyGrant(booking, legacyCode);
      }
      return;
    }

    await this.generateAndProvision(booking);
  }

  private async importLegacyGrant(booking: Booking, legacyCode: { code: string; playgroundName?: string }): Promise<void> {
    const { ciphertext, iv } = encryptAccessCode(this.config, legacyCode.code);
    const grant = await this.repo.create({
      booking: { connect: { id: booking.id } },
      codeCiphertext: ciphertext,
      codeIv: iv,
      origin: "LEGACY_IMPORTED",
      scope: legacyCode.playgroundName ?? booking.courtId,
      status: "ACTIVE",
      validFrom: booking.startAt,
      validUntil: booking.endAt,
      provisionedAt: new Date(),
      providerReference: "legacy:doinsport",
    });
    logger.info({ event: "AccessGrantImported", bookingId: booking.id, grantId: grant.id }, "code d'accès Legacy importé (CDC §35/§78)");
  }

  private async generateAndProvision(booking: Booking): Promise<void> {
    const scope = booking.courtId;
    const validFrom = new Date(booking.startAt.getTime() - this.config.ACCESS_ENABLED_BEFORE_MINUTES * 60_000);
    const validUntil = new Date(booking.endAt.getTime() + this.config.ACCESS_ENABLED_AFTER_MINUTES * 60_000);

    let code: string | undefined;
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
      const candidate = generateRandomAccessCode();
      const overlapping = await this.repo.findOverlappingActive(scope, validFrom, validUntil);
      const candidateCollides = await this.collidesWithExisting(overlapping, candidate);
      if (!candidateCollides) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      logger.error({ event: "AccessCodeGenerationExhausted", bookingId: booking.id }, "impossible de générer un code sans collision (CDC §34.2)");
      return;
    }

    const { ciphertext, iv } = encryptAccessCode(this.config, code);
    const grant = await this.repo.create({
      booking: { connect: { id: booking.id } },
      codeCiphertext: ciphertext,
      codeIv: iv,
      origin: "V2_GENERATED",
      scope,
      status: "PENDING",
      validFrom,
      validUntil,
    });

    try {
      const providerRef = await this.provider.provisionGrant({ id: grant.id, code, scope, validFrom, validUntil });
      await this.repo.updateStatus(grant.id, "ACTIVE", { provisionedAt: new Date(), providerReference: providerRef.providerReference });
      logger.info({ event: "AccessGrantProvisioned", bookingId: booking.id, grantId: grant.id }, "code d'accès provisionné");
    } catch (err) {
      // CDC §36 : un échec de provisioning ne doit jamais faire échouer la
      // confirmation de réservation elle-même — l'accès est un automatisme
      // en aval, pas une condition de paiement.
      await this.repo.updateStatus(grant.id, "FAILED");
      logger.error({ event: "AccessGrantProvisioningFailed", bookingId: booking.id, grantId: grant.id, err }, "échec de provisioning du code d'accès");
    }
  }

  private async collidesWithExisting(overlapping: Array<{ codeCiphertext: string; codeIv: string }>, candidate: string): Promise<boolean> {
    return overlapping.some((g) => decryptAccessCode(this.config, g.codeCiphertext, g.codeIv) === candidate);
  }

  async revokeForBooking(bookingId: string): Promise<void> {
    const grants = await this.repo.findActiveByBookingId(bookingId);
    for (const grant of grants) {
      try {
        const code = decryptAccessCode(this.config, grant.codeCiphertext, grant.codeIv);
        await this.provider.revokeGrant({ id: grant.id, code, scope: grant.scope, validFrom: grant.validFrom, validUntil: grant.validUntil });
      } catch (err) {
        logger.error({ event: "AccessGrantRevocationFailed", grantId: grant.id, err }, "échec de révocation du code d'accès");
      }
      await this.repo.updateStatus(grant.id, "REVOKED", { revokedAt: new Date() });
    }
  }

  /** Déchiffre le code pour affichage — jamais exposé ailleurs qu'à travers ce point unique. */
  async revealForBooking(bookingId: string): Promise<Array<{ id: string; code: string; origin: string; status: string; validFrom: Date; validUntil: Date }>> {
    const grants = await this.repo.findByBookingId(bookingId);
    return grants
      .filter((g) => g.status === "ACTIVE" || g.status === "PENDING")
      .map((g) => ({
        id: g.id,
        code: decryptAccessCode(this.config, g.codeCiphertext, g.codeIv),
        origin: g.origin,
        status: g.status,
        validFrom: g.validFrom,
        validUntil: g.validUntil,
      }));
  }
}
