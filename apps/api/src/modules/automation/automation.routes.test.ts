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
 * CDC_APV2_COMMANDES_MANUELLES_RASPBERRY_LOGO §25 (tests obligatoires,
 * volet HTTP) : autorisations admin, gate "device en ligne", validation des
 * types de commande — au niveau route plutôt que service, car ce sont
 * précisément les contrôles que le CDC demande de ne jamais confier au seul
 * frontend ("Ne jamais faire confiance uniquement à l'état du bouton").
 */
describe("Automation — commandes manuelles (routes HTTP)", () => {
  let prisma: PrismaClient;
  let app: Express;

  beforeAll(() => {
    resetConfigCacheForTests();
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const config = { ...loadConfig(), ACCESS_DEVICE_SYNC_ENABLED: true };
    app = createApp({ prisma, config });
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.$disconnect();
  });

  async function loginAs(role: "STAFF" | "ADMIN" | "SUPER_ADMIN" | "CUSTOMER"): Promise<string> {
    const email = `automation-routes-${role.toLowerCase()}-${Date.now()}-${Math.random()}@example.com`;
    const passwordHash = await hashPassword("MotDePasseSolide123");
    const repo = new IdentityRepository(prisma);
    const user = await repo.createUser({ email, passwordHash, firstName: "T", lastName: "U", role });
    await repo.activateUser(user.id);
    const login = await request(app).post("/api/v1/auth/login").send({ email, password: "MotDePasseSolide123" });
    if (login.status !== 200) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
    return login.headers["set-cookie"] as string;
  }

  async function registerOnlineDevice(adminCookie: string): Promise<{ deviceId: string; deviceKey: string }> {
    const registered = await request(app).post("/api/v1/admin/automation-devices").set("Cookie", adminCookie).send({ name: "Raspberry test HTTP" });
    expect(registered.status).toBe(201);
    const { deviceId, deviceKey } = registered.body.data as { deviceId: string; deviceKey: string };
    const heartbeat = await request(app).post("/api/v1/devices/automation/heartbeat").set("Authorization", `Bearer ${deviceKey}`).send({});
    expect(heartbeat.status).toBe(204);
    return { deviceId, deviceKey };
  }

  it("ADMIN + device ONLINE + DOOR_OPEN -> commande créée (201)", async () => {
    const adminCookie = await loginAs("ADMIN");
    const { deviceId } = await registerOnlineDevice(adminCookie);

    const res = await request(app).post(`/api/v1/admin/automation-devices/${deviceId}/commands`).set("Cookie", adminCookie).send({ type: "DOOR_OPEN" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: "DOOR_OPEN", status: "PENDING", deviceId });
  });

  it("ADMIN + device OFFLINE (jamais vu) -> refus 409 AUTOMATION_DEVICE_OFFLINE", async () => {
    const adminCookie = await loginAs("ADMIN");
    const registered = await request(app).post("/api/v1/admin/automation-devices").set("Cookie", adminCookie).send({ name: "Raspberry jamais vu" });
    const deviceId = registered.body.data.deviceId as string;

    const res = await request(app).post(`/api/v1/admin/automation-devices/${deviceId}/commands`).set("Cookie", adminCookie).send({ type: "DOOR_OPEN" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("AUTOMATION_DEVICE_OFFLINE");
  });

  it("non-admin (STAFF) -> refus 403, même avec un device en ligne", async () => {
    const adminCookie = await loginAs("ADMIN");
    const staffCookie = await loginAs("STAFF");
    const { deviceId } = await registerOnlineDevice(adminCookie);

    const res = await request(app).post(`/api/v1/admin/automation-devices/${deviceId}/commands`).set("Cookie", staffCookie).send({ type: "DOOR_OPEN" });
    expect(res.status).toBe(403);
  });

  it("CUSTOMER -> refus 403", async () => {
    const adminCookie = await loginAs("ADMIN");
    const customerCookie = await loginAs("CUSTOMER");
    const { deviceId } = await registerOnlineDevice(adminCookie);

    const res = await request(app).post(`/api/v1/admin/automation-devices/${deviceId}/commands`).set("Cookie", customerCookie).send({ type: "DOOR_OPEN" });
    expect(res.status).toBe(403);
  });

  it("non authentifié -> refus 401", async () => {
    const adminCookie = await loginAs("ADMIN");
    const { deviceId } = await registerOnlineDevice(adminCookie);

    const res = await request(app).post(`/api/v1/admin/automation-devices/${deviceId}/commands`).send({ type: "DOOR_OPEN" });
    expect(res.status).toBe(401);
  });

  it("accepte les quatre types de commande manuelle", async () => {
    const adminCookie = await loginAs("ADMIN");
    for (const type of ["DOOR_OPEN", "DOOR_CLOSE", "LIGHT_ON", "LIGHT_OFF"]) {
      const { deviceId } = await registerOnlineDevice(adminCookie);
      const res = await request(app).post(`/api/v1/admin/automation-devices/${deviceId}/commands`).set("Cookie", adminCookie).send({ type });
      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(type);
    }
  });

  it("type de commande inconnu -> 422 (jamais transmis tel quel au service/à la base)", async () => {
    const adminCookie = await loginAs("ADMIN");
    const { deviceId } = await registerOnlineDevice(adminCookie);

    const res = await request(app).post(`/api/v1/admin/automation-devices/${deviceId}/commands`).set("Cookie", adminCookie).send({ type: "OPEN_SESAME" });
    expect(res.status).toBe(422);
  });

  it("expose le statut de la commande et l'historique du device, et reflète un ACK FAILED", async () => {
    const adminCookie = await loginAs("ADMIN");
    const { deviceId, deviceKey } = await registerOnlineDevice(adminCookie);

    const created = await request(app).post(`/api/v1/admin/automation-devices/${deviceId}/commands`).set("Cookie", adminCookie).send({ type: "LIGHT_ON" });
    const commandId = created.body.data.id as string;

    // Livraison (le Raspberry récupère le snapshot).
    const snapshot = await request(app).get("/api/v1/devices/automation/snapshot").set("Authorization", `Bearer ${deviceKey}`);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.data.commands).toHaveLength(1);

    // ACK en échec.
    const ack = await request(app)
      .post(`/api/v1/devices/automation/commands/${commandId}/ack`)
      .set("Authorization", `Bearer ${deviceKey}`)
      .send({ status: "FAILED", error: "LOGO_CONNECTION_FAILED" });
    expect(ack.status).toBe(204);

    const status = await request(app).get(`/api/v1/admin/automation-commands/${commandId}`).set("Cookie", adminCookie);
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ status: "FAILED", result: "LOGO_CONNECTION_FAILED" });

    const history = await request(app).get(`/api/v1/admin/automation-devices/${deviceId}/commands`).set("Cookie", adminCookie);
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({ id: commandId, status: "FAILED" });
  });

  /** Demande explicite : marges avant/après par terrain éditables dans l'interface. */
  it("PATCH /admin/automation-zones/:id edits margin overrides, ADMIN-only, STAFF refused", async () => {
    const adminCookie = await loginAs("ADMIN");
    const staffCookie = await loginAs("STAFF");

    const created = await request(app).post("/api/v1/admin/automation-zones").set("Cookie", adminCookie).send({ key: "main_entry", type: "DOOR", label: "Entrée principale" });
    expect(created.status).toBe(201);
    const zoneId = created.body.data.id as string;

    const refused = await request(app).patch(`/api/v1/admin/automation-zones/${zoneId}`).set("Cookie", staffCookie).send({ doorBeforeMinutes: 10 });
    expect(refused.status).toBe(403);

    const updated = await request(app).patch(`/api/v1/admin/automation-zones/${zoneId}`).set("Cookie", adminCookie).send({ doorBeforeMinutes: 10, doorAfterMinutes: 20 });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ doorBeforeMinutes: 10, doorAfterMinutes: 20 });

    const listed = await request(app).get("/api/v1/admin/automation-zones").set("Cookie", adminCookie);
    expect(listed.body.data.find((z: { id: string }) => z.id === zoneId)).toMatchObject({ doorBeforeMinutes: 10, doorAfterMinutes: 20 });
  });
});
