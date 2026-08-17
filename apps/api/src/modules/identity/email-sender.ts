/**
 * Interface minimale, préfigurant `NotificationProvider` (CDC §98, Lot 8).
 * Au Lot 1, seule une implémentation de développement existe : elle ne doit
 * jamais être utilisée en dehors de NODE_ENV=development et n'écrit que sur
 * stdout local (jamais via le logger structuré applicatif, pour ne pas faire
 * fuiter un lien à usage unique dans une pipeline de logs — CDC §57.1).
 */
export interface EmailSender {
  sendVerificationEmail(to: string, verificationUrl: string): Promise<void>;
  sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>;
  /** CDC §54 écran 18 — confirmation envoyée à la *nouvelle* adresse, jamais à l'ancienne. */
  sendEmailChangeConfirmation(to: string, confirmUrl: string): Promise<void>;
  /** CDC §26, §38 — invitation à payer une part de réservation partagée. */
  sendSplitInvitationEmail(to: string, shareUrl: string): Promise<void>;
  /** CDC §7.3 — invitation à migrer un compte Doinsport ("Shadow Client") vers un compte V2. */
  sendMigrationInvitation(to: string, inviteUrl: string): Promise<void>;
  /**
   * CDC §37.1, §98 — canal générique pour les templates dispatchés depuis
   * `notification_outbox` (Lot 8). `template`/`payload` typés en `unknown`
   * ici pour ne pas faire dépendre `identity/` du module `notifications/`
   * (évite une dépendance circulaire) ; `NotificationDispatcher` est seul
   * responsable de la cohérence des payloads par template.
   */
  sendTemplatedEmail(to: string, template: string, payload: Record<string, unknown>): Promise<void>;
}

export class DevConsoleEmailSender implements EmailSender {
  async sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[dev-email] Vérification de compte pour ${to} : ${verificationUrl}`);
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[dev-email] Réinitialisation mot de passe pour ${to} : ${resetUrl}`);
  }

  async sendSplitInvitationEmail(to: string, shareUrl: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[dev-email] Invitation à payer une part de réservation pour ${to} : ${shareUrl}`);
  }

  async sendEmailChangeConfirmation(to: string, confirmUrl: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[dev-email] Confirmation de changement d'adresse pour ${to} : ${confirmUrl}`);
  }

  async sendTemplatedEmail(to: string, template: string, payload: Record<string, unknown>): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[dev-email] ${template} pour ${to} :`, payload);
  }

  async sendMigrationInvitation(to: string, inviteUrl: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[dev-email] Invitation à migrer votre compte pour ${to} : ${inviteUrl}`);
  }
}
