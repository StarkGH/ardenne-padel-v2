import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { createApp } from "../../app.js";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { FakePaymentProvider } from "./testing/fake-payment-provider.js";

/**
 * CDC §54 écran 19 — gestion des moyens de paiement enregistrés. Testé au
 * niveau route (pas juste `StripePaymentProvider`) pour couvrir la
 * dégradation "pas de stripeCustomerId encore" (liste vide sans appel
 * provider) et l'appartenance (404 sur un id d'un autre utilisateur).
 */
describe("Payment methods routes (CDC §54 écran 19)", () => {
  let prisma: PrismaClient;
  let app: Express;
  let paymentProvider: FakePaymentProvider;

  beforeAll(() => {
    resetConfigCacheForTests();
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    paymentProvider = new FakePaymentProvider();
    const config = loadConfig();
    app = createApp({ prisma, config, paymentProvider });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function registerAndLogin(email: string): Promise<string> {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "MotDePasseSolide123", firstName: "Joueur", lastName: "Test" });
    await prisma.user.update({ where: { email }, data: { status: "ACTIVE" } });
    const login = await request(app).post("/api/v1/auth/login").send({ email, password: "MotDePasseSolide123" });
    return login.headers["set-cookie"] as string;
  }

  it("returns an empty list without calling the provider when the user has no stripeCustomerId yet", async () => {
    const cookie = await registerAndLogin("sans-carte@example.com");
    const res = await request(app).get("/api/v1/me/payment-methods").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("lists saved cards for a user with a stripeCustomerId", async () => {
    const cookie = await registerAndLogin("avec-carte@example.com");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "avec-carte@example.com" } });
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: "cus_fake_1" } });
    paymentProvider.savedMethods.set("cus_fake_1", [
      { id: "pm_1", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
    ]);

    const res = await request(app).get("/api/v1/me/payment-methods").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: "pm_1", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 }]);
  });

  it("deletes a saved card belonging to the caller", async () => {
    const cookie = await registerAndLogin("suppression@example.com");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "suppression@example.com" } });
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: "cus_fake_2" } });
    paymentProvider.savedMethods.set("cus_fake_2", [
      { id: "pm_2", brand: "mastercard", last4: "4444", expMonth: 6, expYear: 2029 },
    ]);

    const del = await request(app).delete("/api/v1/me/payment-methods/pm_2").set("Cookie", cookie);
    expect(del.status).toBe(204);

    const after = await request(app).get("/api/v1/me/payment-methods").set("Cookie", cookie);
    expect(after.body.data).toEqual([]);
  });

  it("refuses to delete a card belonging to another user's Stripe customer (404, not a Stripe pass-through)", async () => {
    const cookieA = await registerAndLogin("victime@example.com");
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: "victime@example.com" } });
    await prisma.user.update({ where: { id: userA.id }, data: { stripeCustomerId: "cus_fake_victime" } });
    paymentProvider.savedMethods.set("cus_fake_victime", [
      { id: "pm_victime", brand: "visa", last4: "1111", expMonth: 1, expYear: 2031 },
    ]);

    const cookieB = await registerAndLogin("attaquant@example.com");
    const userB = await prisma.user.findUniqueOrThrow({ where: { email: "attaquant@example.com" } });
    await prisma.user.update({ where: { id: userB.id }, data: { stripeCustomerId: "cus_fake_attaquant" } });

    const del = await request(app).delete("/api/v1/me/payment-methods/pm_victime").set("Cookie", cookieB);
    expect(del.status).toBe(404);

    const stillThere = await request(app).get("/api/v1/me/payment-methods").set("Cookie", cookieA);
    expect(stillThere.body.data).toHaveLength(1);
  });
});
