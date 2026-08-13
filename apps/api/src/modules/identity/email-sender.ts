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
}
