import { AppError, ErrorCodes, logger } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import { normalizeEmail, type IdentityRepository } from "./identity.repository.js";
import type { EmailSender } from "./email-sender.js";
import { assertPasswordStrength, hashPassword, verifyPassword } from "./password.js";
import { generateOpaqueToken, hashToken } from "./tokens.js";

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface UpdateProfileInput {
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}

export class IdentityService {
  constructor(
    private readonly repo: IdentityRepository,
    private readonly config: AppConfig,
    private readonly emailSender: EmailSender,
  ) {}

  async register(input: RegisterInput) {
    assertPasswordStrength(input.password);

    const existing = await this.repo.findUserByEmail(input.email);
    if (existing) {
      // CDC §111 : ne jamais révéler d'information utilisable pour énumérer les comptes.
      throw new AppError(
        ErrorCodes.EMAIL_ALREADY_REGISTERED,
        "Impossible de créer ce compte avec ces informations.",
        409,
      );
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.repo.createUser({
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    });

    await this.issueEmailVerification(user.id, user.email);

    logger.info({ event: "UserRegistered", userId: user.id }, "user registered");
    return { id: user.id, email: user.email, status: user.status };
  }

  private async issueEmailVerification(userId: string, email: string) {
    const { raw, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 3600_000);
    await this.repo.createEmailVerificationToken({ userId, tokenHash: hash, expiresAt });

    const verificationUrl = `${this.config.PUBLIC_BASE_URL}/verify-email?token=${raw}`;
    await this.emailSender.sendVerificationEmail(email, verificationUrl);
  }

  async resendVerificationEmail(email: string) {
    const user = await this.repo.findUserByEmail(email);
    // Réponse identique que l'utilisateur existe ou non (anti-énumération).
    if (!user || user.status !== "PENDING_VERIFICATION") return;
    await this.issueEmailVerification(user.id, user.email);
  }

  async verifyEmail(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const token = await this.repo.findValidEmailVerificationToken(tokenHash);
    if (!token) {
      throw new AppError(ErrorCodes.TOKEN_INVALID_OR_EXPIRED, "Lien de vérification invalide ou expiré.", 400);
    }

    await this.repo.markEmailVerificationTokenUsed(token.id);
    const user = await this.repo.activateUser(token.userId);

    logger.info({ event: "UserEmailVerified", userId: user.id }, "user email verified");
    return { id: user.id, email: user.email, status: user.status };
  }

  async login(input: LoginInput) {
    const windowMs = this.config.LOGIN_FAILED_ATTEMPTS_WINDOW_MINUTES * 60_000;
    const recentFailures = await this.repo.countRecentFailedAttempts(input.email, windowMs);
    if (recentFailures >= this.config.LOGIN_MAX_FAILED_ATTEMPTS) {
      throw new AppError(
        ErrorCodes.TOO_MANY_LOGIN_ATTEMPTS,
        "Trop de tentatives échouées. Réessayez plus tard.",
        429,
      );
    }

    const user = await this.repo.findUserByEmail(input.email);
    const passwordOk = user ? await verifyPassword(input.password, user.passwordHash) : false;

    if (!user || !passwordOk) {
      await this.repo.recordLoginAttempt({ email: input.email, ipAddress: input.ipAddress, success: false });
      throw new AppError(ErrorCodes.INVALID_CREDENTIALS, "Identifiants invalides.", 401);
    }

    if (user.status === "DISABLED") {
      await this.repo.recordLoginAttempt({ email: input.email, ipAddress: input.ipAddress, success: false });
      throw new AppError(ErrorCodes.INVALID_CREDENTIALS, "Identifiants invalides.", 401);
    }

    if (user.status === "PENDING_VERIFICATION") {
      throw new AppError(ErrorCodes.EMAIL_NOT_VERIFIED, "Merci de vérifier votre e-mail avant de vous connecter.", 403);
    }

    await this.repo.recordLoginAttempt({ email: input.email, ipAddress: input.ipAddress, success: true });
    await this.repo.touchLastLogin(user.id);

    const { raw, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_DAYS * 86_400_000);
    await this.repo.createSession({
      userId: user.id,
      tokenHash: hash,
      expiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    logger.info({ event: "UserLoggedIn", userId: user.id }, "user logged in");
    return {
      sessionToken: raw,
      expiresAt,
      user: { id: user.id, email: user.email, role: user.role, status: user.status },
    };
  }

  async logout(rawSessionToken: string) {
    await this.repo.revokeSessionByTokenHash(hashToken(rawSessionToken));
  }

  async logoutAll(userId: string) {
    await this.repo.revokeAllSessionsForUser(userId);
    logger.info({ event: "UserLoggedOutAllSessions", userId }, "all sessions revoked");
  }

  async getUserFromSessionToken(rawSessionToken: string) {
    const session = await this.repo.findActiveSessionByTokenHash(hashToken(rawSessionToken));
    if (!session) return null;
    return session.user;
  }

  async requestPasswordReset(email: string) {
    const user = await this.repo.findUserByEmail(email);
    if (!user) return; // anti-énumération : pas d'erreur si l'e-mail est inconnu.

    const { raw, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000);
    await this.repo.createPasswordResetToken({ userId: user.id, tokenHash: hash, expiresAt });

    const resetUrl = `${this.config.PUBLIC_BASE_URL}/reset-password?token=${raw}`;
    await this.emailSender.sendPasswordResetEmail(user.email, resetUrl);
  }

  async resetPassword(rawToken: string, newPassword: string) {
    assertPasswordStrength(newPassword);

    const tokenHash = hashToken(rawToken);
    const token = await this.repo.findValidPasswordResetToken(tokenHash);
    if (!token) {
      throw new AppError(ErrorCodes.TOKEN_INVALID_OR_EXPIRED, "Lien de réinitialisation invalide ou expiré.", 400);
    }

    const passwordHash = await hashPassword(newPassword);
    await this.repo.updatePasswordHash(token.userId, passwordHash);
    await this.repo.markPasswordResetTokenUsed(token.id);
    // Réinitialiser le mot de passe révoque toutes les sessions actives par précaution.
    await this.repo.revokeAllSessionsForUser(token.userId);

    logger.info({ event: "UserPasswordReset", userId: token.userId }, "user password reset");
  }

  private toProfile(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    role: string;
    status: string;
    pilotUser: boolean;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      status: user.status,
      pilotUser: user.pilotUser,
      createdAt: user.createdAt,
    };
  }

  /** CDC §54 écran 18 — profil. */
  async getProfile(userId: string) {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new AppError(ErrorCodes.NOT_FOUND, "Utilisateur introuvable.", 404);
    return this.toProfile(user);
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    const user = await this.repo.updateProfile(userId, input);
    logger.info({ event: "UserProfileUpdated", userId }, "user profile updated");
    return this.toProfile(user);
  }

  /** Changement de mot de passe authentifié — distinct du flux par jeton (`resetPassword`) qui, lui, ne connaît pas le mot de passe actuel. */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new AppError(ErrorCodes.NOT_FOUND, "Utilisateur introuvable.", 404);

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw new AppError(ErrorCodes.INVALID_CREDENTIALS, "Mot de passe actuel incorrect.", 401);

    assertPasswordStrength(newPassword);
    const passwordHash = await hashPassword(newPassword);
    await this.repo.updatePasswordHash(userId, passwordHash);

    logger.info({ event: "UserPasswordChanged", userId }, "user password changed");
  }

  /**
   * CDC §54 écran 18 — changement d'e-mail avec re-vérification. Exige le
   * mot de passe actuel (comme `changePassword`) : une session volée ne
   * suffit pas à rediriger silencieusement les e-mails de récupération de
   * compte vers une adresse contrôlée par l'attaquant. Le lien de
   * confirmation part vers la *nouvelle* adresse — l'ancienne ne reçoit
   * jamais rien tant que le changement n'a pas été confirmé.
   */
  async requestEmailChange(userId: string, newEmail: string, currentPassword: string): Promise<void> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new AppError(ErrorCodes.NOT_FOUND, "Utilisateur introuvable.", 404);

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw new AppError(ErrorCodes.INVALID_CREDENTIALS, "Mot de passe actuel incorrect.", 401);

    const normalized = normalizeEmail(newEmail);
    if (normalized === user.email) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Cette adresse est déjà celle de votre compte.", 422);
    }
    const existing = await this.repo.findUserByEmail(normalized);
    if (existing) {
      throw new AppError(ErrorCodes.EMAIL_ALREADY_REGISTERED, "Cette adresse e-mail est déjà utilisée.", 409);
    }

    const { raw, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 3600_000);
    await this.repo.createEmailChangeToken({ userId, newEmail: normalized, tokenHash: hash, expiresAt });

    const confirmUrl = `${this.config.PUBLIC_BASE_URL}/profile/email-change?token=${raw}`;
    await this.emailSender.sendEmailChangeConfirmation(normalized, confirmUrl);

    logger.info({ event: "EmailChangeRequested", userId }, "changement d'e-mail demandé");
  }

  async confirmEmailChange(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const token = await this.repo.findValidEmailChangeToken(tokenHash);
    if (!token) {
      throw new AppError(ErrorCodes.TOKEN_INVALID_OR_EXPIRED, "Lien de confirmation invalide ou expiré.", 400);
    }

    // Revérifie l'unicité au moment de la confirmation : quelqu'un a pu
    // prendre cette adresse entre la demande et le clic sur le lien.
    const existing = await this.repo.findUserByEmail(token.newEmail);
    if (existing && existing.id !== token.userId) {
      throw new AppError(ErrorCodes.EMAIL_ALREADY_REGISTERED, "Cette adresse e-mail est déjà utilisée.", 409);
    }

    await this.repo.updateUserEmail(token.userId, token.newEmail);
    await this.repo.markEmailChangeTokenUsed(token.id);

    logger.info({ event: "EmailChanged", userId: token.userId }, "user email changed");
    return { email: token.newEmail };
  }
}
