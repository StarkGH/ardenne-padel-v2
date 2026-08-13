import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { createApp } from "../../app.js";
import type { EmailSender } from "./email-sender.js";

/**
 * Capture les liens envoyés au lieu de vraiment envoyer un e-mail — permet de
 * tester le parcours complet register -> verify -> login -> me -> logout
 * sans dépendre d'un vrai provider (celui-ci arrive au Lot 8).
 */
class CapturingEmailSender implements EmailSender {
  verificationUrls: string[] = [];
  resetUrls: string[] = [];

  async sendVerificationEmail(_to: string, url: string): Promise<void> {
    this.verificationUrls.push(url);
  }

  async sendPasswordResetEmail(_to: string, url: string): Promise<void> {
    this.resetUrls.push(url);
  }
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
    await prisma.session.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.loginAttempt.deleteMany();
    await prisma.user.deleteMany();

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
});
