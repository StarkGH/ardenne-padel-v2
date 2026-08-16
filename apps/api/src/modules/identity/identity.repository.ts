import type { PrismaClient, Role } from "@prisma/client";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class IdentityRepository {
  constructor(private readonly db: PrismaClient) {}

  findUserByEmail(email: string) {
    return this.db.user.findUnique({ where: { email: normalizeEmail(email) } });
  }

  findUserById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }

  createUser(input: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    role?: Role;
  }) {
    return this.db.user.create({
      data: {
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
        role: input.role ?? "CUSTOMER",
        status: "PENDING_VERIFICATION",
      },
    });
  }

  activateUser(userId: string) {
    return this.db.user.update({
      where: { id: userId },
      data: { status: "ACTIVE" },
    });
  }

  updatePasswordHash(userId: string, passwordHash: string) {
    return this.db.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  updateProfile(userId: string, input: { firstName: string; lastName: string; phone?: string | null }) {
    return this.db.user.update({
      where: { id: userId },
      data: { firstName: input.firstName, lastName: input.lastName, phone: input.phone ?? null },
    });
  }

  updateUserEmail(userId: string, email: string) {
    return this.db.user.update({ where: { id: userId }, data: { email } });
  }

  touchLastLogin(userId: string) {
    return this.db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }

  // --- Sessions ---

  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
  }) {
    return this.db.session.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
      },
    });
  }

  findActiveSessionByTokenHash(tokenHash: string) {
    return this.db.session.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
  }

  revokeSessionByTokenHash(tokenHash: string) {
    return this.db.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllSessionsForUser(userId: string) {
    return this.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // --- Email verification ---

  createEmailVerificationToken(input: { userId: string; tokenHash: string; expiresAt: Date }) {
    return this.db.emailVerificationToken.create({ data: input });
  }

  findValidEmailVerificationToken(tokenHash: string) {
    return this.db.emailVerificationToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  markEmailVerificationTokenUsed(id: string) {
    return this.db.emailVerificationToken.update({ where: { id }, data: { usedAt: new Date() } });
  }

  // --- Password reset ---

  createPasswordResetToken(input: { userId: string; tokenHash: string; expiresAt: Date }) {
    return this.db.passwordResetToken.create({ data: input });
  }

  findValidPasswordResetToken(tokenHash: string) {
    return this.db.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  markPasswordResetTokenUsed(id: string) {
    return this.db.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } });
  }

  // --- Changement d'e-mail (CDC §54 écran 18) ---

  createEmailChangeToken(input: { userId: string; newEmail: string; tokenHash: string; expiresAt: Date }) {
    return this.db.emailChangeToken.create({ data: { ...input, newEmail: normalizeEmail(input.newEmail) } });
  }

  findValidEmailChangeToken(tokenHash: string) {
    return this.db.emailChangeToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  markEmailChangeTokenUsed(id: string) {
    return this.db.emailChangeToken.update({ where: { id }, data: { usedAt: new Date() } });
  }

  // --- Login attempts (rate limiting, CDC §59.1) ---

  recordLoginAttempt(input: { email: string; ipAddress?: string | null; success: boolean }) {
    return this.db.loginAttempt.create({
      data: {
        email: normalizeEmail(input.email),
        ipAddress: input.ipAddress ?? null,
        success: input.success,
      },
    });
  }

  countRecentFailedAttempts(email: string, sinceMs: number): Promise<number> {
    return this.db.loginAttempt.count({
      where: {
        email: normalizeEmail(email),
        success: false,
        createdAt: { gt: new Date(Date.now() - sinceMs) },
      },
    });
  }
}
