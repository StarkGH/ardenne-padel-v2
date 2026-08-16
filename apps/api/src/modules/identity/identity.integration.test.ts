import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { createApp } from "../../app.js";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import type { EmailSender } from "./email-sender.js";

/**
 * Capture les liens envoyés au lieu de vraiment envoyer un e-mail — permet de
 * tester le parcours complet register -> verify -> login -> me -> logout
 * sans dépendre d'un vrai provider (celui-ci arrive au Lot 8).
 */
class CapturingEmailSender implements EmailSender {
  verificationUrls: string[] = [];
  resetUrls: string[] = [];
  emailChangeUrls: string[] = [];

  async sendVerificationEmail(_to: string, url: string): Promise<void> {
    this.verificationUrls.push(url);
  }

  async sendPasswordResetEmail(_to: string, url: string): Promise<void> {
    this.resetUrls.push(url);
  }

  async sendEmailChangeConfirmation(_to: string, url: string): Promise<void> {
    this.emailChangeUrls.push(url);
  }

  async sendSplitInvitationEmail(): Promise<void> {}
  async sendTemplatedEmail(): Promise<void> {}
}

function extractToken(url: string): string {
  const parsed = new URL(url);
  const token = parsed.searchParams.get("token");
  if (!token) throw new Error(`Aucun token dans l'URL capturée: ${url}`);
  return token;
}

describe("Identity — parcours complet (CDC §7.2, §43)", () => {
  let prisma: PrismaClient;
  let app: Express;
  let emailSender: CapturingEmailSender;

  beforeAll(() => {
    resetConfigCacheForTests();
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);

    emailSender = new CapturingEmailSender();
    const config = loadConfig();
    app = createApp({ prisma, config, emailSender });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const credentials = {
    email: "joueur.test@example.com",
    password: "MotDePasseSolide123",
    firstName: "Joueur",
    lastName: "Test",
  };

  it("register -> refuse login before verification -> verify -> login -> /me -> logout -> /me refused", async () => {
    const registerRes = await request(app).post("/api/v1/auth/register").send(credentials);
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.data.status).toBe("PENDING_VERIFICATION");

    const loginBeforeVerify = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    expect(loginBeforeVerify.status).toBe(403);
    expect(loginBeforeVerify.body.error.code).toBe("EMAIL_NOT_VERIFIED");

    expect(emailSender.verificationUrls).toHaveLength(1);
    const verificationToken = extractToken(emailSender.verificationUrls[0]!);

    const verifyRes = await request(app).post("/api/v1/auth/verify-email").send({ token: verificationToken });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.status).toBe("ACTIVE");

    const verifyAgain = await request(app).post("/api/v1/auth/verify-email").send({ token: verificationToken });
    expect(verifyAgain.status).toBe(400); // usage unique

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers["set-cookie"] as string;
    expect(cookie).toBeDefined();

    const meRes = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.email).toBe(credentials.email);

    const logoutRes = await request(app).post("/api/v1/auth/logout").set("Cookie", cookie);
    expect(logoutRes.status).toBe(204);

    const meAfterLogout = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(meAfterLogout.status).toBe(401);
  });

  it("rejects wrong password with generic error and does not leak account existence", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "inconnu@example.com", password: "peu-importe12" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects duplicate registration without revealing which field conflicts precisely", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);
    const second = await request(app).post("/api/v1/auth/register").send(credentials);
    expect(second.status).toBe(409);
  });

  it("logout-all revokes every active session for the user", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);
    const token = extractToken(emailSender.verificationUrls[0]!);
    await request(app).post("/api/v1/auth/verify-email").send({ token });

    const loginA = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    const loginB = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });

    const cookieA = loginA.headers["set-cookie"] as string;
    const cookieB = loginB.headers["set-cookie"] as string;

    await request(app).post("/api/v1/auth/logout-all").set("Cookie", cookieA);

    const meA = await request(app).get("/api/v1/auth/me").set("Cookie", cookieA);
    const meB = await request(app).get("/api/v1/auth/me").set("Cookie", cookieB);
    expect(meA.status).toBe(401);
    expect(meB.status).toBe(401);
  });

  it("password reset flow revokes existing sessions and allows login with the new password", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);
    const verifyToken = extractToken(emailSender.verificationUrls[0]!);
    await request(app).post("/api/v1/auth/verify-email").send({ token: verifyToken });

    const loginBefore = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    const cookieBefore = loginBefore.headers["set-cookie"] as string;

    await request(app).post("/api/v1/auth/password/forgot").send({ email: credentials.email });
    expect(emailSender.resetUrls).toHaveLength(1);
    const resetToken = extractToken(emailSender.resetUrls[0]!);

    const resetRes = await request(app)
      .post("/api/v1/auth/password/reset")
      .send({ token: resetToken, newPassword: "NouveauMotDePasse456" });
    expect(resetRes.status).toBe(204);

    const meWithOldSession = await request(app).get("/api/v1/auth/me").set("Cookie", cookieBefore);
    expect(meWithOldSession.status).toBe(401);

    const loginOldPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    expect(loginOldPassword.status).toBe(401);

    const loginNewPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: "NouveauMotDePasse456" });
    expect(loginNewPassword.status).toBe(200);
  });

  it("GET/PATCH /me/profile reads and updates the authenticated user's name and phone (CDC §54 écran 18)", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);
    const verifyToken = extractToken(emailSender.verificationUrls[0]!);
    await request(app).post("/api/v1/auth/verify-email").send({ token: verifyToken });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    const cookie = login.headers["set-cookie"] as string;

    const before = await request(app).get("/api/v1/me/profile").set("Cookie", cookie);
    expect(before.status).toBe(200);
    expect(before.body.data).toMatchObject({ firstName: "Joueur", lastName: "Test", phone: null });

    const update = await request(app)
      .patch("/api/v1/me/profile")
      .set("Cookie", cookie)
      .send({ firstName: "Joueuse", lastName: "Testée", phone: "+32470000000" });
    expect(update.status).toBe(200);
    expect(update.body.data).toMatchObject({ firstName: "Joueuse", lastName: "Testée", phone: "+32470000000" });

    const after = await request(app).get("/api/v1/me/profile").set("Cookie", cookie);
    expect(after.body.data).toMatchObject({ firstName: "Joueuse", lastName: "Testée", phone: "+32470000000" });
  });

  it("GET /me/profile is refused without a session, like /auth/me", async () => {
    const res = await request(app).get("/api/v1/me/profile");
    expect(res.status).toBe(401);
  });

  it("POST /auth/password/change lets the user log in with the new password, keeping the current session valid", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);
    const verifyToken = extractToken(emailSender.verificationUrls[0]!);
    await request(app).post("/api/v1/auth/verify-email").send({ token: verifyToken });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    const cookie = login.headers["set-cookie"] as string;

    const change = await request(app)
      .post("/api/v1/auth/password/change")
      .set("Cookie", cookie)
      .send({ currentPassword: credentials.password, newPassword: "UnAutreMotDePasse789" });
    expect(change.status).toBe(204);

    // La session courante reste valide (changement de mot de passe volontaire, pas une réinitialisation d'urgence).
    const meAfterChange = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(meAfterChange.status).toBe(200);

    const loginOldPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    expect(loginOldPassword.status).toBe(401);

    const loginNewPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: "UnAutreMotDePasse789" });
    expect(loginNewPassword.status).toBe(200);
  });

  it("POST /auth/password/change rejects an incorrect current password without changing anything", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);
    const verifyToken = extractToken(emailSender.verificationUrls[0]!);
    await request(app).post("/api/v1/auth/verify-email").send({ token: verifyToken });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    const cookie = login.headers["set-cookie"] as string;

    const change = await request(app)
      .post("/api/v1/auth/password/change")
      .set("Cookie", cookie)
      .send({ currentPassword: "MauvaisMotDePasse", newPassword: "UnAutreMotDePasse789" });
    expect(change.status).toBe(401);
    expect(change.body.error.code).toBe("INVALID_CREDENTIALS");

    const loginStillOldPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    expect(loginStillOldPassword.status).toBe(200);
  });

  it("changes the account email end-to-end: request, confirm via the emailed link, login with the new address", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);
    const verifyToken = extractToken(emailSender.verificationUrls[0]!);
    await request(app).post("/api/v1/auth/verify-email").send({ token: verifyToken });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    const cookie = login.headers["set-cookie"] as string;

    const request1 = await request(app)
      .post("/api/v1/me/profile/email-change")
      .set("Cookie", cookie)
      .send({ newEmail: "nouvelle-adresse@example.com", currentPassword: credentials.password });
    expect(request1.status).toBe(202);
    expect(emailSender.emailChangeUrls).toHaveLength(1);
    // Le lien part vers la nouvelle adresse, jamais vers l'ancienne.
    expect(emailSender.emailChangeUrls[0]).toContain("/profile/email-change?token=");

    // L'e-mail du compte n'a pas encore changé tant que le lien n'est pas cliqué.
    const meBeforeConfirm = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(meBeforeConfirm.body.data.email).toBe(credentials.email);

    const confirmToken = extractToken(emailSender.emailChangeUrls[0]!);
    const confirm = await request(app).post("/api/v1/auth/email-change/confirm").send({ token: confirmToken });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.email).toBe("nouvelle-adresse@example.com");

    // La session courante reste valide (même logique que le changement de mot de passe).
    const meAfterConfirm = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(meAfterConfirm.status).toBe(200);
    expect(meAfterConfirm.body.data.email).toBe("nouvelle-adresse@example.com");

    const loginOldEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    expect(loginOldEmail.status).toBe(401);

    const loginNewEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nouvelle-adresse@example.com", password: credentials.password });
    expect(loginNewEmail.status).toBe(200);
  });

  it("POST /me/profile/email-change rejects an incorrect current password without sending anything", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);
    const verifyToken = extractToken(emailSender.verificationUrls[0]!);
    await request(app).post("/api/v1/auth/verify-email").send({ token: verifyToken });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    const cookie = login.headers["set-cookie"] as string;

    const res = await request(app)
      .post("/api/v1/me/profile/email-change")
      .set("Cookie", cookie)
      .send({ newEmail: "autre@example.com", currentPassword: "MauvaisMotDePasse" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(emailSender.emailChangeUrls).toHaveLength(0);
  });

  it("POST /me/profile/email-change rejects an address already used by another account", async () => {
    const other = { email: "deja-pris@example.com", password: "AutreMotDePasse123", firstName: "Autre", lastName: "Compte" };
    await request(app).post("/api/v1/auth/register").send(other);

    await request(app).post("/api/v1/auth/register").send(credentials);
    const verifyToken = extractToken(emailSender.verificationUrls[emailSender.verificationUrls.length - 1]!);
    await request(app).post("/api/v1/auth/verify-email").send({ token: verifyToken });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    const cookie = login.headers["set-cookie"] as string;

    const res = await request(app)
      .post("/api/v1/me/profile/email-change")
      .set("Cookie", cookie)
      .send({ newEmail: other.email, currentPassword: credentials.password });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("POST /auth/email-change/confirm rejects an unknown or already-used token", async () => {
    const res = await request(app).post("/api/v1/auth/email-change/confirm").send({ token: "jeton-inconnu" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TOKEN_INVALID_OR_EXPIRED");
  });
});
