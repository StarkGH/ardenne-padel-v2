import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "@ardenne/config";
import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import { generateOpaqueToken, hashToken } from "../identity/tokens.js";
import { assertPasswordStrength, hashPassword } from "../identity/password.js";
import { normalizeEmail, type IdentityRepository } from "../identity/identity.repository.js";
import type { EmailSender } from "../identity/email-sender.js";
import type { AuditLogService } from "../admin/audit-log.service.js";

/**
 * CDC §7.3 — flux de migration Doinsport → V2 (étapes 3 à 8, la stratégie
 * "sans authentification joueur Doinsport") : un admin déclenche l'envoi
 * d'un lien unique à durée limitée, le joueur le suit, choisit son mot de
 * passe et son "Shadow Client" (`LegacyClient`) est lié à son nouveau
 * compte V2 — la possession du lien vaut vérification d'e-mail (étape 5),
 * donc le compte créé est directement `ACTIVE`, jamais
 * `PENDING_VERIFICATION`.
 */
export class MigrationInvitationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly identityRepo: IdentityRepository,
    private readonly config: AppConfig,
    private readonly emailSender: EmailSender,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Déclenché par un admin (écran `/admin/legacy-clients`), jamais
   * automatiquement à l'import — l'envoi en masse d'invitations doit rester
   * gouverné par la stratégie de cohortes (`docs/migration.md`), pas se
   * déclencher dès qu'un client Legacy est synchronisé.
   */
  async invite(actorUserId: string, legacyClientId: string) {
    const client = await this.db.legacyClient.findUnique({ where: { id: legacyClientId } });
    if (!client) throw new AppError(ErrorCodes.NOT_FOUND, "Client Legacy introuvable.", 404);

    // LEGACY_ONLY (cas nominal) ou INVITED (renvoi du lien) — jamais depuis
    // un état déjà résolu ou en conflit, même logique de garde que
    // `LegacyMigrationAdminService.linkToUser` (ADR-0034).
    if (!["LEGACY_ONLY", "INVITED"].includes(client.migrationStatus)) {
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        `Ce client est en statut ${client.migrationStatus} — impossible de l'inviter depuis cet état.`,
        409,
      );
    }
    if (!client.email) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Ce client n'a pas d'adresse e-mail connue — impossible de l'inviter.", 422);
    }

    const normalizedEmail = normalizeEmail(client.email);
    const existingUser = await this.identityRepo.findUserByEmail(normalizedEmail);
    if (existingUser) {
      // La déduplication automatique (CDC §7.5, ADR-0031) aurait dû
      // détecter ce cas à l'import — filet de sécurité si le compte V2 a été
      // créé après coup (register direct) plutôt que par migration.
      throw new AppError(
        ErrorCodes.EMAIL_ALREADY_REGISTERED,
        "Un compte V2 existe déjà avec cette adresse — utilisez la liaison manuelle plutôt qu'une invitation.",
        409,
      );
    }

    const { raw, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.CLIENT_MIGRATION_INVITATION_TTL_HOURS * 3600_000);
    await this.db.clientMigrationInvitation.create({ data: { legacyClientId: client.id, tokenHash: hash, expiresAt } });

    const updated = await this.db.legacyClient.update({ where: { id: client.id }, data: { migrationStatus: "INVITED" } });

    const inviteUrl = `${this.config.PUBLIC_BASE_URL}/migrate?token=${raw}`;
    await this.emailSender.sendMigrationInvitation(normalizedEmail, inviteUrl);

    await this.auditLog.record({
      actorUserId,
      action: "LEGACY_CLIENT_INVITED",
      targetType: "LegacyClient",
      targetId: client.id,
      before: { migrationStatus: client.migrationStatus },
      after: { migrationStatus: updated.migrationStatus },
    });

    logger.info({ event: "LegacyClientInvited", legacyClientId: client.id }, "invitation de migration envoyée");
    return updated;
  }

  /**
   * Public, appelé quand le joueur ouvre le lien reçu — valide le jeton
   * sans le consommer (le joueur peut recharger la page/revenir sans que
   * ça grille son lien) et renvoie l'identité à préremplir sur l'écran de
   * création de mot de passe.
   */
  async validateToken(rawToken: string) {
    const invitation = await this.findValidInvitation(rawToken);
    const client = invitation.legacyClient;

    if (client.migrationStatus === "INVITED") {
      await this.db.legacyClient.update({ where: { id: client.id }, data: { migrationStatus: "MIGRATION_PENDING" } });
    }

    return { firstName: client.firstName, lastName: client.lastName, email: client.email };
  }

  /** Public — création du compte V2 et liaison du Shadow Client (CDC §7.3, étapes 6-8). Pas d'audit log admin : action self-service du joueur, pas une action administrative (CDC §58). */
  async confirm(rawToken: string, password: string) {
    assertPasswordStrength(password);

    const invitation = await this.findValidInvitation(rawToken);
    const client = invitation.legacyClient;

    if (!client.email) {
      // Ne devrait jamais arriver — invite() exige déjà un e-mail. Garde défensive.
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Ce client n'a pas d'adresse e-mail connue.", 422);
    }

    const normalizedEmail = normalizeEmail(client.email);
    // Revalidé au moment de la confirmation, pas seulement à l'invitation :
    // quelqu'un a pu s'inscrire directement avec cette adresse entretemps.
    const existingUser = await this.identityRepo.findUserByEmail(normalizedEmail);
    if (existingUser) {
      throw new AppError(ErrorCodes.EMAIL_ALREADY_REGISTERED, "Un compte existe déjà avec cette adresse e-mail.", 409);
    }

    const passwordHash = await hashPassword(password);
    // Possession du lien = e-mail vérifié (CDC §7.3, étape 5) : ACTIVE
    // directement, jamais PENDING_VERIFICATION (pas de second e-mail à
    // confirmer après celui-ci).
    const user = await this.identityRepo.createUser({
      email: normalizedEmail,
      passwordHash,
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone,
      status: "ACTIVE",
    });

    await this.db.legacyClient.update({ where: { id: client.id }, data: { migrationStatus: "MIGRATED", linkedUserId: user.id } });
    await this.db.clientMigrationInvitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } });

    logger.info({ event: "LegacyClientMigrated", legacyClientId: client.id, userId: user.id }, "migration Doinsport terminée");
    return { email: user.email };
  }

  private async findValidInvitation(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const invitation = await this.db.clientMigrationInvitation.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      include: { legacyClient: true },
    });
    // Même message quel que soit le motif (jeton inconnu, expiré, ou client
    // entretemps repassé DISABLED/MERGE_REQUIRED/reset par un admin) — pas
    // d'énumération possible depuis l'erreur.
    if (!invitation || !["INVITED", "MIGRATION_PENDING"].includes(invitation.legacyClient.migrationStatus)) {
      throw new AppError(ErrorCodes.TOKEN_INVALID_OR_EXPIRED, "Lien d'invitation invalide ou expiré.", 400);
    }
    return invitation;
  }
}
