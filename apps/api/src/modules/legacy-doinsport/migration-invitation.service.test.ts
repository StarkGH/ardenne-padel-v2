import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests, type AppConfig } from "@ardenne/config";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { AuditLogRepository } from "../admin/audit-log.repository.js";
import { AuditLogService } from "../admin/audit-log.service.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import { hashPassword } from "../identity/password.js";
import type { EmailSender } from "../identity/email-sender.js";
import { MigrationInvitationService } from "./migration-invitation.service.js";

class CapturingEmailSender implements EmailSender {
  inviteUrls: string[] = [];
  async sendVerificationEmail(): Promise<void> {}
  async sendPasswordResetEmail(): Promise<void> {}
  async sendEmailChangeConfirmation(): Promise<void> {}
  async sendSplitInvitationEmail(): Promise<void> {}
  async sendTemplatedEmail(): Promise<void> {}
  async sendMigrationInvitation(_to: string, url: string): Promise<void> {
    this.inviteUrls.push(url);
  }
}

function tokenFromUrl(url: string): string {
  return new URL(url).searchParams.get("token")!;
}

/** CDC §7.3 — invitation admin + auto-inscription du joueur (lien = e-mail vérifié). */
describe("MigrationInvitationService", () => {
  const prisma = new PrismaClient();
  let actorUserId: string;

  beforeAll(() => {
    resetConfigCacheForTests();
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const actor = await prisma.user.create({
      data: { email: `migration-actor-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "S", lastName: "T", status: "ACTIVE", role: "ADMIN" },
    });
    actorUserId = actor.id;
  });

  function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
    return { ...loadConfig(), ...overrides };
  }

  function buildService(emailSender: CapturingEmailSender) {
    const auditLog = new AuditLogService(new AuditLogRepository(prisma));
    return new MigrationInvitationService(prisma, new IdentityRepository(prisma), buildConfig(), emailSender, auditLog);
  }

  async function createLegacyOnlyClient(overrides: Partial<{ email: string | null; phone: string | null }> = {}) {
    return prisma.legacyClient.create({
      data: {
        externalId: `ext-${Date.now()}-${Math.random()}`,
        firstName: "Jean",
        lastName: "Dupont",
        email: overrides.email === undefined ? `jean-${Date.now()}-${Math.random()}@example.com` : overrides.email,
        phone: overrides.phone ?? null,
        migrationStatus: "LEGACY_ONLY",
        lastSyncedAt: new Date(),
      },
    });
  }

  it("invite() envoie un lien, passe le client en INVITED et audite l'action", async () => {
    const client = await createLegacyOnlyClient();
    const emailSender = new CapturingEmailSender();
    const service = buildService(emailSender);

    const updated = await service.invite(actorUserId, client.id);

    expect(updated.migrationStatus).toBe("INVITED");
    expect(emailSender.inviteUrls).toHaveLength(1);
    const invitations = await prisma.clientMigrationInvitation.findMany({ where: { legacyClientId: client.id } });
    expect(invitations).toHaveLength(1);
    expect(invitations[0]!.usedAt).toBeNull();

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "LegacyClient", targetId: client.id });
    expect(entries.some((e) => e.action === "LEGACY_CLIENT_INVITED")).toBe(true);
  });

  it("invite() rejette un client sans e-mail connu", async () => {
    const client = await createLegacyOnlyClient({ email: null });
    const service = buildService(new CapturingEmailSender());

    await expect(service.invite(actorUserId, client.id)).rejects.toMatchObject({ httpStatus: 422 });
  });

  it("invite() rejette si un compte V2 existe déjà avec cet e-mail", async () => {
    const email = `deja-inscrit-${Date.now()}@example.com`;
    await prisma.user.create({ data: { email, passwordHash: "x", firstName: "A", lastName: "B", status: "ACTIVE" } });
    const client = await createLegacyOnlyClient({ email });
    const service = buildService(new CapturingEmailSender());

    await expect(service.invite(actorUserId, client.id)).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("invite() rejette depuis un statut déjà résolu (MIGRATED)", async () => {
    const client = await createLegacyOnlyClient();
    await prisma.legacyClient.update({ where: { id: client.id }, data: { migrationStatus: "MIGRATED" } });
    const service = buildService(new CapturingEmailSender());

    await expect(service.invite(actorUserId, client.id)).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("validateToken() fait passer le client de INVITED à MIGRATION_PENDING et renvoie son identité", async () => {
    const client = await createLegacyOnlyClient();
    const emailSender = new CapturingEmailSender();
    const service = buildService(emailSender);
    await service.invite(actorUserId, client.id);
    const token = tokenFromUrl(emailSender.inviteUrls[0]!);

    const identity = await service.validateToken(token);

    expect(identity.email).toBe(client.email);
    const updated = await prisma.legacyClient.findUnique({ where: { id: client.id } });
    expect(updated!.migrationStatus).toBe("MIGRATION_PENDING");
  });

  it("validateToken() rejette un jeton inconnu ou expiré", async () => {
    const service = buildService(new CapturingEmailSender());
    await expect(service.validateToken("jeton-inexistant")).rejects.toMatchObject({ httpStatus: 400 });
  });

  it("confirm() crée un compte V2 ACTIVE, lie le Shadow Client et consomme le jeton", async () => {
    const client = await createLegacyOnlyClient();
    const emailSender = new CapturingEmailSender();
    const service = buildService(emailSender);
    await service.invite(actorUserId, client.id);
    const token = tokenFromUrl(emailSender.inviteUrls[0]!);
    await service.validateToken(token);

    const result = await service.confirm(token, "MotDePasseSolide123");

    expect(result.email).toBe(client.email);
    const user = await prisma.user.findUnique({ where: { email: client.email! } });
    expect(user).not.toBeNull();
    expect(user!.status).toBe("ACTIVE");

    const updatedClient = await prisma.legacyClient.findUnique({ where: { id: client.id } });
    expect(updatedClient!.migrationStatus).toBe("MIGRATED");
    expect(updatedClient!.linkedUserId).toBe(user!.id);

    const invitation = await prisma.clientMigrationInvitation.findFirst({ where: { legacyClientId: client.id } });
    expect(invitation!.usedAt).not.toBeNull();

    // Le jeton est à usage unique — une seconde confirmation doit échouer.
    await expect(service.confirm(token, "AutreMotDePasseSolide123")).rejects.toMatchObject({ httpStatus: 400 });
  });

  it("confirm() rejette un mot de passe trop court", async () => {
    const client = await createLegacyOnlyClient();
    const emailSender = new CapturingEmailSender();
    const service = buildService(emailSender);
    await service.invite(actorUserId, client.id);
    const token = tokenFromUrl(emailSender.inviteUrls[0]!);

    await expect(service.confirm(token, "court")).rejects.toMatchObject({ httpStatus: 422 });
  });

  it("confirm() rejette si l'e-mail a été pris entretemps par un autre compte", async () => {
    const client = await createLegacyOnlyClient();
    const emailSender = new CapturingEmailSender();
    const service = buildService(emailSender);
    await service.invite(actorUserId, client.id);
    const token = tokenFromUrl(emailSender.inviteUrls[0]!);

    // Quelqu'un s'inscrit directement avec la même adresse entre l'invitation et la confirmation.
    await prisma.user.create({
      data: { email: client.email!, passwordHash: await hashPassword("PeuImporteLeMotDePasse1"), firstName: "X", lastName: "Y", status: "ACTIVE" },
    });

    await expect(service.confirm(token, "MotDePasseSolide123")).rejects.toMatchObject({ httpStatus: 409 });
  });
});
