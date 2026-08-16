import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import { loadConfig, resetConfigCacheForTests } from "@ardenne/config";
import { createApp } from "../../app.js";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { DevConsoleEmailSender } from "../identity/email-sender.js";
import { FakePaymentProvider } from "../payments/testing/fake-payment-provider.js";

/**
 * Parcours HTTP complet CDC §18/§27/§91 : disponibilités -> devis ->
 * authentification -> réservation (`CHECKOUT_PENDING`) -> checkout paiement
 * (`POST /payments/checkout`) -> confirmée -> annulation. `LEGACY_WRITE_ENABLED`
 * reste à sa valeur par défaut (false) : aucun appel réseau vers Doinsport ici.
 * Aucune clé Stripe requise : `FakePaymentProvider` injecté (pas encore de
 * compte Stripe pour Ardenne Padel, voir docs/operations.md).
 */
describe("Bookings — parcours HTTP complet (sans Legacy)", () => {
  let prisma: PrismaClient;
  let app: Express;
  let courtId: string;

  beforeAll(async () => {
    resetConfigCacheForTests();
    prisma = new PrismaClient();

    const court = await prisma.court.upsert({
      where: { slug: "test-padel-x" },
      update: {},
      create: { slug: "test-padel-x", name: "Test Padel X", courtType: "DOUBLE", capacity: 4, displayOrder: 99 },
    });
    courtId = court.id;

    await prisma.openingRule.deleteMany({ where: { courtId } });
    await prisma.durationRule.deleteMany({ where: { courtId } });
    await prisma.tariffRule.deleteMany({ where: { courtId } });

    await prisma.openingRule.create({
      data: { courtId, dayOfWeek: 0, startTime: "08:00", endTime: "22:00", validFrom: new Date("2020-01-01") },
    });
    for (let d = 0; d <= 6; d++) {
      await prisma.openingRule.create({
        data: { courtId, dayOfWeek: d, startTime: "08:00", endTime: "22:00", validFrom: new Date("2020-01-01") },
      });
    }
    await prisma.durationRule.create({
      data: {
        courtId,
        startTime: "00:00",
        endTime: "23:59",
        allowedDurationsMinutes: [60],
        validFrom: new Date("2020-01-01"),
      },
    });
    await prisma.tariffRule.create({
      data: {
        name: "Tarif test",
        courtId,
        validFrom: new Date("2020-01-01"),
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "00:00",
        endTime: "23:59",
        durationMinutes: 60,
        priceTotalCents: 4800,
        referenceCapacity: 4,
        priority: 10,
        tags: [],
      },
    });
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);

    const config = loadConfig();
    expect(config.LEGACY_WRITE_ENABLED).toBe(false); // garde-fou : ce test ne doit jamais toucher Doinsport
    app = createApp({
      prisma,
      config,
      emailSender: new DevConsoleEmailSender(),
      paymentProvider: new FakePaymentProvider(),
    });
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.durationRule.deleteMany({ where: { courtId } });
    await prisma.openingRule.deleteMany({ where: { courtId } });
    await prisma.court.delete({ where: { id: courtId } });
    await prisma.$disconnect();
  });

  function nextMondayAt(hour: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7)); // prochain lundi (toujours dans le futur)
    d.setHours(hour, 0, 0, 0);
    // Garantit une marge > 24h (échéance d'annulation) quelle que soit l'heure d'exécution du test.
    if (d.getTime() - Date.now() < 25 * 3600_000) {
      d.setDate(d.getDate() + 7);
    }
    return d;
  }

  async function registerAndLogin(): Promise<string[]> {
    const credentials = {
      email: "joueur.booking@example.com",
      password: "MotDePasseSolide123",
      firstName: "Joueur",
      lastName: "Booking",
    };
    let capturedToken = "";
    const capturingApp = createApp({
      prisma,
      config: loadConfig(),
      emailSender: {
        sendVerificationEmail: async (_to, url) => {
          capturedToken = new URL(url).searchParams.get("token")!;
        },
        sendPasswordResetEmail: async () => {},
        sendSplitInvitationEmail: async () => {},
        sendTemplatedEmail: async () => {},
      },
    });
    await request(capturingApp).post("/api/v1/auth/register").send(credentials);
    await request(capturingApp).post("/api/v1/auth/verify-email").send({ token: capturedToken });
    const loginRes = await request(capturingApp)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    return loginRes.headers["set-cookie"] as unknown as string[];
  }

  it("shows availability, a price quote, then lets an authenticated user book and cancel", async () => {
    const monday10am = nextMondayAt(10);
    const dateISO = monday10am.toISOString().slice(0, 10);

    const availabilityRes = await request(app).get("/api/v1/availability").query({ courtId, date: dateISO });
    expect(availabilityRes.status).toBe(200);
    expect(availabilityRes.body.data.length).toBeGreaterThan(0);
    const slotAt10 = availabilityRes.body.data.find((s: { startTime: string }) => s.startTime === "10:00");
    expect(slotAt10.allowedDurationsMinutes).toContain(60);

    const quoteRes = await request(app)
      .get("/api/v1/pricing/quote")
      .query({ courtId, startAt: monday10am.toISOString(), durationMinutes: 60 });
    expect(quoteRes.status).toBe(200);
    expect(quoteRes.body.data.priceTotalCents).toBe(4800);

    const cookie = await registerAndLogin();

    const createRes = await request(app)
      .post("/api/v1/bookings")
      .set("Cookie", cookie)
      .send({ courtId, startAt: monday10am.toISOString(), durationMinutes: 60 });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe("CHECKOUT_PENDING");
    expect(createRes.body.data.priceTotalCents).toBe(4800);
    const bookingId = createRes.body.data.id;

    const checkoutRes = await request(app)
      .post("/api/v1/payments/checkout")
      .set("Cookie", cookie)
      .send({ bookingId, paymentMethodId: "pm_card_visa" });
    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.data.requiresAction).toBe(false);
    expect(checkoutRes.body.data.bookingStatus).toBe("CONFIRMED");

    const meRes = await request(app).get("/api/v1/me/bookings").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.some((b: { id: string }) => b.id === bookingId)).toBe(true);

    const cancelRes = await request(app).post(`/api/v1/bookings/${bookingId}/cancel`).set("Cookie", cookie);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe("CANCELED");
  });

  it("rejects cancellation past the client-facing cancellation deadline (CDC §29)", async () => {
    const monday14 = nextMondayAt(14);
    const cookie = await registerAndLogin();

    const createRes = await request(app)
      .post("/api/v1/bookings")
      .set("Cookie", cookie)
      .send({ courtId, startAt: monday14.toISOString(), durationMinutes: 60 });
    const bookingId = createRes.body.data.id;
    await request(app).post("/api/v1/payments/checkout").set("Cookie", cookie).send({ bookingId, paymentMethodId: "pm_card_visa" });

    // Simule l'échéance déjà passée (le délai réel — 24h avant le créneau —
    // rendrait ce test dépendant de l'heure d'exécution).
    await prisma.booking.update({ where: { id: bookingId }, data: { cancellationDeadline: new Date(Date.now() - 3600_000) } });

    const cancelRes = await request(app).post(`/api/v1/bookings/${bookingId}/cancel`).set("Cookie", cookie);
    expect(cancelRes.status).toBe(409);
    expect(cancelRes.body.error.code).toBe("CANCELLATION_DEADLINE_PASSED");

    const stillConfirmed = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(stillConfirmed.status).toBe("CONFIRMED");
  });

  it("rejects booking creation for an unauthenticated visitor", async () => {
    const monday11am = nextMondayAt(11);
    const res = await request(app)
      .post("/api/v1/bookings")
      .send({ courtId, startAt: monday11am.toISOString(), durationMinutes: 60 });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown court on the availability endpoint", async () => {
    const res = await request(app)
      .get("/api/v1/availability")
      .query({ courtId: "00000000-0000-0000-0000-000000000000", date: "2030-01-01" });
    expect(res.status).toBe(404);
  });
});
