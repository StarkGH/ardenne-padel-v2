import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { KioskDeviceRepository } from "./kiosk-device.repository.js";
import { KioskDeviceService } from "./kiosk-device.service.js";

/**
 * CDC §22.6, §59.2 — enregistrement, authentification et révocation des
 * dispositifs kiosque, contre une vraie base (aucun mock du domaine).
 */
describe("KioskDeviceService", () => {
  const prisma = new PrismaClient();
  const repo = new KioskDeviceRepository(prisma);
  const service = new KioskDeviceService(repo);

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.$disconnect();
  });

  it("registers a device and returns the raw key exactly once", async () => {
    const result = await service.register({ name: "Tablette accueil", capabilities: ["QR_HANDOFF"] });
    expect(result.deviceId).toBeTruthy();
    expect(result.deviceKey).toMatch(/^[A-Za-z0-9_-]+$/);

    const stored = await repo.findById(result.deviceId);
    expect(stored?.deviceKeyHash).not.toBe(result.deviceKey); // jamais la clé brute en base
  });

  it("authenticates a registered device with its raw key and updates lastSeenAt", async () => {
    const { deviceId, deviceKey } = await service.register({ name: "Tablette 2", capabilities: ["QR_HANDOFF", "TERMINAL"] });
    const authenticated = await service.authenticate(deviceKey);
    expect(authenticated.status).toBe("ACTIVE");

    const stored = await repo.findById(deviceId);
    expect(stored?.lastSeenAt).not.toBeNull();
  });

  it("rejects authentication with an unknown key", async () => {
    await expect(service.authenticate("clef-inconnue")).rejects.toMatchObject({ httpStatus: 401 });
  });

  it("rejects authentication for a revoked device", async () => {
    const { deviceId, deviceKey } = await service.register({ name: "Tablette révoquée", capabilities: ["QR_HANDOFF"] });
    await service.revoke(deviceId);
    await expect(service.authenticate(deviceKey)).rejects.toMatchObject({ httpStatus: 401 });
  });

  it("lists only active devices", async () => {
    const { deviceId: revokedId } = await service.register({ name: "Ancienne tablette", capabilities: ["QR_HANDOFF"] });
    await service.register({ name: "Tablette active", capabilities: ["QR_HANDOFF"] });
    await service.revoke(revokedId);

    const active = await service.listActive();
    expect(active.some((d) => d.id === revokedId)).toBe(false);
    expect(active.length).toBe(1);
  });

  it("considers a device offline past the configured silence threshold (CDC §39.3)", () => {
    expect(service.isOffline(null, 5)).toBe(true);
    expect(service.isOffline(new Date(Date.now() - 10 * 60_000), 5)).toBe(true);
    expect(service.isOffline(new Date(), 5)).toBe(false);
  });
});
