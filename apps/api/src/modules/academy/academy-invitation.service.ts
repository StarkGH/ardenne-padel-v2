import { AppError, ErrorCodes } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import { generateOpaqueToken, hashToken } from "../identity/tokens.js";
import type { AcademyRepository } from "./academy.repository.js";
import type { EmailSender } from "../identity/email-sender.js";

const DEFAULT_INVITATION_TTL_HOURS = 24 * 14; // 14 jours — le temps de collecter des dispos, cf. ACADEMY_MVP_SPEC.md §3.

export interface CreateInvitationInput {
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
}

/**
 * Accès élève temporaire sécurisé (besoin urgent §8) : réutilise directement
 * les primitives de `identity/tokens.ts` (mêmes garanties que la
 * vérification e-mail / reset mot de passe V2 — token aléatoire 256 bits,
 * seul le hash SHA-256 est stocké, jamais loggé).
 */
export class AcademyInvitationService {
  constructor(
    private readonly repo: AcademyRepository,
    private readonly emailSender: EmailSender,
    private readonly config: Pick<AppConfig, "PUBLIC_BASE_URL">,
  ) {}

  /**
   * Crée (ou retrouve) l'élève, révoque ses invitations actives, en émet une
   * nouvelle et envoie le lien directement (jamais via `notification_outbox`
   * — même raison que `MigrationInvitationService` : un token brut ne doit
   * jamais dormir en base en clair dans un payload différé).
   */
  async createInvitation(input: CreateInvitationInput): Promise<{ studentId: string }> {
    const student = (await this.repo.findStudentByEmail(input.email)) ?? (await this.repo.createStudent(input));

    await this.repo.revokeActiveInvitationsForStudent(student.id);

    const { raw, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + DEFAULT_INVITATION_TTL_HOURS * 60 * 60 * 1000);
    await this.repo.createInvitation({ studentId: student.id, tokenHash: hash, expiresAt });

    const inviteUrl = `${this.config.PUBLIC_BASE_URL}/academy/i/${raw}`;
    await this.emailSender.sendAcademyInvitation(student.email, inviteUrl);

    return { studentId: student.id };
  }

  /** Résout un token brut reçu par lien : rejette expiré/révoqué/inconnu sans distinguer la cause (CDC §8 — token non prédictible, pas d'énumération). */
  async resolveInvitation(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const invitation = await this.repo.findInvitationByTokenHash(tokenHash);

    if (!invitation || invitation.revokedAt || invitation.expiresAt < new Date()) {
      throw new AppError(ErrorCodes.TOKEN_INVALID_OR_EXPIRED, "Lien invalide ou expiré.", 401);
    }

    if (!invitation.usedAt) {
      await this.repo.markInvitationUsed(invitation.id);
    }

    return invitation.student;
  }

  revoke(invitationId: string) {
    return this.repo.revokeInvitation(invitationId);
  }
}
