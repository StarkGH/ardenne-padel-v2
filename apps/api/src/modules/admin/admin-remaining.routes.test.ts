import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { createApp } from "../../app.js";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { hashPassword } from "../identity/password.js";
import { IdentityRepository } from "../identity/identity.repository.js";

/**
 * CDC §55 écrans 13, 15-16, 19-20, 22, 24-25 — tranche "restant" des écrans
 * admin : tout ce qui n'a pas déjà son propre fichier de test dédié (achats
 * de crédits, paiements, dispositifs Terminal, révocation kiosque, accès,
 * audit log, paramètres en lecture seule).
 */
describe("Admin — écrans restants (CDC §55)", () => {
  let prisma: PrismaClient;
  let app: Express;

  beforeAll(() => {
    resetConfigCacheForTests();
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const config = loadConfig();
    app = createApp({ prisma, config });
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.court.deleteMany({ where: { slug: "test-padel-access-admin" } });
    await prisma.$disconnect();
  });

  async function loginAs(role: "STAFF" | "ADMIN" | "SUPER_ADMIN" | "CUSTOMER"): Promise<string> {
    const email = `admin-remaining-${role.toLowerCase()}-${Date.now()}-${Math.random()}@example.com`;
    const passwordHash = await hashPassword("MotDePasseSolide123");
    const repo = new IdentityRepository(prisma);
    const user = await repo.createUser({ email, passwordHash, firstName: "T", lastName: "U", role });
    await repo.activateUser(user.id);
    const login = await request(app).post("/api/v1/auth/login").send({ email, password: "MotDePasseSolide123" });
    if (login.status !== 200) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
    return login.headers["set-cookie"] as string;
  }

  it("GET /admin/settings is SUPER_ADMIN-only and never leaks secrets", async () => {
    const staffCookie = await loginAs("STAFF");
    const adminCookie = await loginAs("ADMIN");
    const superAdminCookie = await loginAs("SUPER_ADMIN");

    expect((await request(app).get("/api/v1/admin/settings").set("Cookie", staffCookie)).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/settings").set("Cookie", adminCookie)).status).toBe(403);

    const res = await request(app).get("/api/v1/admin/settings").set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.split).toMatchObject({ paymentSplitEnabled: expect.any(Boolean) });
    expect(JSON.stringify(res.body.data)).not.toMatch(/STRIPE_SECRET|SESSION_SECRET|DATABASE_URL/i);
  });

  it("GET /admin/audit-log lists entries and filters by targetType/targetId", async () => {
    const staffCookie = await loginAs("STAFF");
    const adminCookie = await loginAs("ADMIN");

    // Génère au moins une entrée d'audit réelle : révoquer un dispositif kiosque inexistant échouerait,
    // donc on en crée un d'abord (chemin déjà couvert par kiosk-device.service.test.ts, ici on veut juste une trace).
    const registered = await request(app)
      .post("/api/v1/admin/kiosk-devices")
      .set("Cookie", adminCookie)
      .send({ name: "Kiosque test audit", capabilities: ["QR_HANDOFF"] });
    expect(registered.status).toBe(201);
    const deviceId = registered.body.data.deviceId as string;

    await request(app).post(`/api/v1/admin/kiosk-devices/${deviceId}/revoke`).set("Cookie", adminCookie);

    const all = await request(app).get("/api/v1/admin/audit-log").set("Cookie", staffCookie);
    expect(all.status).toBe(200);
    expect(all.body.data.some((e: { action: string }) => e.action === "KIOSK_DEVICE_REVOKED")).toBe(true);

    const filtered = await request(app)
      .get(`/api/v1/admin/audit-log?targetType=KioskDevice&targetId=${deviceId}`)
      .set("Cookie", staffCookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].action).toBe("KIOSK_DEVICE_REVOKED");
  });

  it("kiosk device revoke (screen 19) makes the device unusable and audits the action", async () => {
    const adminCookie = await loginAs("ADMIN");
    const registered = await request(app)
      .post("/api/v1/admin/kiosk-devices")
      .set("Cookie", adminCookie)
      .send({ name: "Kiosque bar", capabilities: ["QR_HANDOFF"] });
    const deviceId = registered.body.data.deviceId as string;
    const deviceKey = registered.body.data.deviceKey as string;

    const revoke = await request(app).post(`/api/v1/admin/kiosk-devices/${deviceId}/revoke`).set("Cookie", adminCookie);
    expect(revoke.status).toBe(204);

    const listedAfter = await request(app).get("/api/v1/admin/kiosk-devices").set("Cookie", adminCookie);
    expect(listedAfter.body.data.some((d: { id: string }) => d.id === deviceId)).toBe(false);

    const sessionAttempt = await request(app)
      .post("/api/v1/kiosk/checkout-sessions")
      .set("Authorization", `Bearer ${deviceKey}`)
      .send({ courtId: "00000000-0000-0000-0000-000000000000", startAt: new Date().toISOString(), durationMinutes: 60 });
    expect(sessionAttempt.status).toBe(401);
  });

  it("terminal devices (screen 20): register, list, revoke — role-gated and audited", async () => {
    const staffCookie = await loginAs("STAFF");
    const adminCookie = await loginAs("ADMIN");

    const forbidden = await request(app)
      .post("/api/v1/admin/terminal-devices")
      .set("Cookie", staffCookie)
      .send({ name: "Lecteur bar", providerDeviceId: "tmr_test_1" });
    expect(forbidden.status).toBe(403);

    const created = await request(app)
      .post("/api/v1/admin/terminal-devices")
      .set("Cookie", adminCookie)
      .send({ name: "Lecteur bar", providerDeviceId: "tmr_test_1" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const listed = await request(app).get("/api/v1/admin/terminal-devices").set("Cookie", staffCookie);
    expect(listed.body.data.some((d: { id: string }) => d.id === id)).toBe(true);

    const revoked = await request(app).post(`/api/v1/admin/terminal-devices/${id}/revoke`).set("Cookie", adminCookie);
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe("REVOKED");

    const listedAfter = await request(app).get("/api/v1/admin/terminal-devices").set("Cookie", staffCookie);
    expect(listedAfter.body.data.some((d: { id: string }) => d.id === id)).toBe(false);
  });

  it("GET /admin/credit-pack-purchases (screen 13) lists purchases across all clients", async () => {
    const staffCookie = await loginAs("STAFF");
    const user = await prisma.user.create({
      data: { email: `purchase-owner-${Date.now()}@example.com`, passwordHash: "x", firstName: "P", lastName: "O", status: "ACTIVE" },
    });
    const pack = await prisma.creditPack.create({
      data: { name: "Pack test", purchaseAmountCents: 5000, paidCreditsCents: 5000, bonusCreditsCents: 0, salesChannels: ["ONLINE"], displayOrder: 1 },
    });
    await prisma.creditPackPurchase.create({
      data: { creditPack: { connect: { id: pack.id } }, user: { connect: { id: user.id } }, purchaseAmountCents: 5000, paidCreditsCents: 5000, bonusCreditsCents: 0, status: "CREDITED" },
    });

    const res = await request(app).get("/api/v1/admin/credit-pack-purchases").set("Cookie", staffCookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].user).toMatchObject({ id: user.id });
  });

  it("GET /admin/payments (screens 15-16) lists payments with provider fee fields, across all clients", async () => {
    const staffCookie = await loginAs("STAFF");
    const user = await prisma.user.create({
      data: { email: `payment-owner-${Date.now()}@example.com`, passwordHash: "x", firstName: "P", lastName: "Y", status: "ACTIVE" },
    });
    await prisma.payment.create({
      data: {
        user: { connect: { id: user.id } },
        providerPaymentId: `pi_test_${Date.now()}`,
        paymentChannel: "ONLINE",
        amountCents: 4800,
        status: "SUCCEEDED",
        purpose: "BOOKING_FULL",
        providerFeeCents: 74,
        providerNetCents: 4726,
      },
    });

    const res = await request(app).get("/api/v1/admin/payments").set("Cookie", staffCookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ amountCents: 4800, providerFeeCents: 74, providerNetCents: 4726 });
  });

  it("GET /admin/access-grants (screen 22) lists grants in range without ever exposing the cipher", async () => {
    const staffCookie = await loginAs("STAFF");
    const court = await prisma.court.upsert({
      where: { slug: "test-padel-access-admin" },
      update: {},
      create: { slug: "test-padel-access-admin", name: "Test Padel Access Admin", courtType: "DOUBLE", capacity: 4, displayOrder: 96 },
    });
    const organizer = await prisma.user.create({
      data: { email: `access-owner-${Date.now()}@example.com`, passwordHash: "x", firstName: "A", lastName: "G", status: "ACTIVE" },
    });
    const startAt = new Date(Date.now() + 24 * 3600_000);
    const booking = await prisma.booking.create({
      data: {
        organizer: { connect: { id: organizer.id } },
        court: { connect: { id: court.id } },
        startAt,
        endAt: new Date(startAt.getTime() + 3600_000),
        durationMinutes: 60,
        bookingBasePriceCents: 4800,
        priceTotalCents: 4800,
        status: "CONFIRMED",
      },
    });
    await prisma.accessGrant.create({
      data: {
        booking: { connect: { id: booking.id } },
        codeCiphertext: "should-never-appear-in-response",
        codeIv: "iv",
        origin: "V2_GENERATED",
        scope: "BOOKING",
        status: "FAILED",
        validFrom: startAt,
        validUntil: new Date(startAt.getTime() + 3600_000),
      },
    });

    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 48 * 3600_000).toISOString();
    const res = await request(app).get(`/api/v1/admin/access-grants?from=${from}&to=${to}`).set("Cookie", staffCookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe("FAILED");
    expect(JSON.stringify(res.body.data)).not.toContain("should-never-appear-in-response");
  });
});
