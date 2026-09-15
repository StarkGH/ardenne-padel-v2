import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { createApp } from "../../app.js";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { hashPassword } from "../identity/password.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import type { EmailSender } from "../identity/email-sender.js";

class CapturingEmailSender implements EmailSender {
  academyInviteUrls: string[] = [];
  async sendVerificationEmail(): Promise<void> {}
  async sendPasswordResetEmail(): Promise<void> {}
  async sendEmailChangeConfirmation(): Promise<void> {}
  async sendSplitInvitationEmail(): Promise<void> {}
  async sendMigrationInvitation(): Promise<void> {}
  async sendTemplatedEmail(): Promise<void> {}
  async sendAcademyInvitation(_to: string, inviteUrl: string): Promise<void> {
    this.academyInviteUrls.push(inviteUrl);
  }
}

function tokenFromInviteUrl(url: string): string {
  return url.split("/academy/i/")[1]!;
}

/**
 * Parcours HTTP complet Academy Phase A (ACADEMY_MVP_SPEC.md) : invitation
 * élève -> token -> disponibilités prof/élève -> créneaux possibles ->
 * proposition -> confirmation. Aucune réservation de terrain réelle
 * n'est déclenchée ici (frontière Phase B assumée).
 */
describe("Academy — parcours HTTP complet Phase A", () => {
  let prisma: PrismaClient;
  let app: Express;
  let emailSender: CapturingEmailSender;
  let courtId: string;

  beforeAll(async () => {
    resetConfigCacheForTests();
    prisma = new PrismaClient();

    const court = await prisma.court.upsert({
      where: { slug: "test-academy-court" },
      update: {},
      create: { slug: "test-academy-court", name: "Test Academy Court", courtType: "DOUBLE", capacity: 4, displayOrder: 99 },
    });
    courtId = court.id;

    await prisma.openingRule.deleteMany({ where: { courtId } });
    await prisma.durationRule.deleteMany({ where: { courtId } });
    for (let d = 0; d <= 6; d++) {
      await prisma.openingRule.create({
        data: { courtId, dayOfWeek: d, startTime: "08:00", endTime: "22:00", validFrom: new Date("2020-01-01") },
      });
    }
    await prisma.durationRule.create({
      data: { courtId, startTime: "00:00", endTime: "23:59", allowedDurationsMinutes: [60], validFrom: new Date("2020-01-01") },
    });
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    // resetIntegrationTestData ne touche pas aux règles d'ouverture/du terrain (fixtures de suite, pas de test).
    const config = loadConfig();
    emailSender = new CapturingEmailSender();
    app = createApp({ prisma, config, emailSender });
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.durationRule.deleteMany({ where: { courtId } });
    await prisma.openingRule.deleteMany({ where: { courtId } });
    await prisma.court.deleteMany({ where: { slug: "test-academy-court" } });
    await prisma.$disconnect();
  });

  async function loginAsCoach(): Promise<{ cookie: string; teacherId: string }> {
    const email = `coach-${Date.now()}-${Math.random()}@example.com`;
    const passwordHash = await hashPassword("MotDePasseSolide123");
    const repo = new IdentityRepository(prisma);
    const user = await repo.createUser({ email, passwordHash, firstName: "Coach", lastName: "Test", role: "COACH" });
    await repo.activateUser(user.id);
    const login = await request(app).post("/api/v1/auth/login").send({ email, password: "MotDePasseSolide123" });
    if (login.status !== 200) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
    return { cookie: login.headers["set-cookie"] as unknown as string, teacherId: user.id };
  }

  async function loginAsStaff(): Promise<string> {
    const email = `staff-${Date.now()}-${Math.random()}@example.com`;
    const passwordHash = await hashPassword("MotDePasseSolide123");
    const repo = new IdentityRepository(prisma);
    const user = await repo.createUser({ email, passwordHash, firstName: "Staff", lastName: "Test", role: "STAFF" });
    await repo.activateUser(user.id);
    const login = await request(app).post("/api/v1/auth/login").send({ email, password: "MotDePasseSolide123" });
    return login.headers["set-cookie"] as unknown as string;
  }

  // Prochain lundi, pour un test stable indépendant du jour d'exécution.
  function nextMonday(): string {
    const d = new Date();
    const day = d.getDay();
    const diff = (8 - day) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  it("laisse un CUSTOMER se voir refuser l'accès aux routes coach", async () => {
    const email = `customer-${Date.now()}@example.com`;
    const passwordHash = await hashPassword("MotDePasseSolide123");
    const repo = new IdentityRepository(prisma);
    const user = await repo.createUser({ email, passwordHash, firstName: "C", lastName: "U", role: "CUSTOMER" });
    await repo.activateUser(user.id);
    const login = await request(app).post("/api/v1/auth/login").send({ email, password: "MotDePasseSolide123" });
    const cookie = login.headers["set-cookie"] as unknown as string;

    const res = await request(app)
      .post("/api/v1/academy/teacher-availability")
      .set("Cookie", cookie)
      .send({ startAt: "2027-01-04T16:00:00.000Z", endAt: "2027-01-04T20:00:00.000Z" });
    expect(res.status).toBe(403);
  });

  it("parcours complet : invitation -> dispo prof/élève -> créneaux possibles -> proposition -> confirmation", async () => {
    const { cookie: coachCookie, teacherId } = await loginAsCoach();
    const staffCookie = await loginAsStaff();

    // 1) Staff invite un élève — le lien part directement par e-mail, jamais renvoyé par l'API.
    const invitationRes = await request(app)
      .post("/api/v1/academy/invitations")
      .set("Cookie", staffCookie)
      .send({ firstName: "Léa", email: `student-${Date.now()}@example.com` });
    expect(invitationRes.status).toBe(201);
    expect(invitationRes.body.data.studentId).toBeTruthy();
    expect(invitationRes.body.data.rawToken).toBeUndefined();
    expect(emailSender.academyInviteUrls).toHaveLength(1);
    const studentToken = tokenFromInviteUrl(emailSender.academyInviteUrls[0]!);

    // 2) L'élève résout son lien sans authentification classique.
    const resolveRes = await request(app).get(`/api/v1/academy/invitations/${studentToken}`);
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.data.firstName).toBe("Léa");

    const date = nextMonday();
    const from = `${date}T00:00:00.000Z`;
    const to = `${date}T23:59:59.000Z`;

    // 3) Le prof déclare sa disponibilité.
    const teacherAvailRes = await request(app)
      .post("/api/v1/academy/teacher-availability")
      .set("Cookie", coachCookie)
      .send({ startAt: `${date}T17:00:00.000Z`, endAt: `${date}T20:00:00.000Z` });
    expect(teacherAvailRes.status).toBe(201);

    // 4) L'élève déclare sa disponibilité via son token, sans compte V2.
    const studentAvailRes = await request(app)
      .post("/api/v1/academy/student-availability")
      .set("X-Academy-Token", studentToken)
      .send({ startAt: `${date}T18:00:00.000Z`, endAt: `${date}T19:30:00.000Z` });
    expect(studentAvailRes.status).toBe(201);
    const studentId = studentAvailRes.body.data.studentId as string;

    // 5) Un élève ne peut pas lire les disponibilités d'un autre token / accéder sans token.
    const noTokenRes = await request(app).get(`/api/v1/academy/student-availability?from=${from}&to=${to}`);
    expect(noTokenRes.status).toBe(401);

    // 6) Le coach consulte les créneaux possibles (prof ∩ élève ∩ terrain réel).
    const slotsRes = await request(app)
      .get("/api/v1/academy/possible-slots")
      .set("Cookie", coachCookie)
      .query({ teacherId, studentIds: studentId, date, durationMinutes: 60, courtIds: courtId });
    expect(slotsRes.status).toBe(200);
    expect(slotsRes.body.data.length).toBeGreaterThan(0);
    // Fenêtre commune Brussels (CEST, UTC+2) = 20:00-21:30 (prof 19:00-22:00 ∩ élève 20:00-21:30 en local).
    expect(slotsRes.body.data[0].startTime).toBe("20:00");
    expect(slotsRes.body.data[0].courtIds).toContain(courtId);

    // 7) Le coach propose un cours sur ce créneau.
    const slot = slotsRes.body.data[0];
    const proposeRes = await request(app)
      .post("/api/v1/academy/lessons")
      .set("Cookie", coachCookie)
      .send({ teacherId, studentIds: [studentId], startAt: `${date}T18:00:00.000Z`, endAt: `${date}T19:00:00.000Z` });
    expect(proposeRes.status).toBe(201);
    expect(proposeRes.body.data.status).toBe("PROPOSED");
    const lessonId = proposeRes.body.data.id as string;

    // 8) L'élève voit son cours proposé.
    const myLessonsRes = await request(app).get("/api/v1/academy/my-lessons").set("X-Academy-Token", studentToken);
    expect(myLessonsRes.status).toBe(200);
    expect(myLessonsRes.body.data).toHaveLength(1);
    expect(myLessonsRes.body.data[0].status).toBe("PROPOSED");

    // 9) Confirmation — n'implique AUCUNE réservation de terrain (bookingId reste null, Phase B).
    const confirmRes = await request(app).post(`/api/v1/academy/lessons/${lessonId}/confirm`).set("Cookie", coachCookie);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.status).toBe("CONFIRMED");
    expect(confirmRes.body.data.bookingId).toBeNull();

    // 10) Annulation possible après confirmation.
    const cancelRes = await request(app).post(`/api/v1/academy/lessons/${lessonId}/cancel`).set("Cookie", coachCookie);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe("CANCELLED");
    expect(slot).toBeTruthy();
  });

  it("empêche un coach de supprimer la disponibilité d'un autre coach", async () => {
    const { cookie: coachACookie } = await loginAsCoach();
    const { cookie: coachBCookie } = await loginAsCoach();
    const date = nextMonday();

    const created = await request(app)
      .post("/api/v1/academy/teacher-availability")
      .set("Cookie", coachACookie)
      .send({ startAt: `${date}T17:00:00.000Z`, endAt: `${date}T20:00:00.000Z` });
    const availabilityId = created.body.data.id as string;

    const res = await request(app).delete(`/api/v1/academy/teacher-availability/${availabilityId}`).set("Cookie", coachBCookie);
    expect(res.status).toBe(403);
  });

  it("rejette un token d'invitation invalide", async () => {
    const res = await request(app).get("/api/v1/academy/invitations/not-a-real-token");
    expect(res.status).toBe(401);
  });
});
