import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { CreditPacksRepository } from "../credit-packs/credit-packs.repository.js";
import { AuditLogRepository } from "./audit-log.repository.js";
import { AuditLogService } from "./audit-log.service.js";
import { CreditPackAdminService } from "./credit-pack-admin.service.js";

/** CDC §39.2 ("credit packs"), §58 ("changement de credit pack") — CRUD admin auditée. */
describe("CreditPackAdminService", () => {
  const prisma = new PrismaClient();
  let actorUserId: string;

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.creditPack.deleteMany();
    const user = await prisma.user.create({
      data: { email: `pack-admin-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "P", lastName: "A", status: "ACTIVE", role: "ADMIN" },
    });
    actorUserId = user.id;
  });

  function buildService() {
    return new CreditPackAdminService(new CreditPacksRepository(prisma), new AuditLogService(new AuditLogRepository(prisma)));
  }

  it("creates a credit pack, auditing the creation", async () => {
    const service = buildService();
    const pack = await service.create(actorUserId, {
      name: "50€ -> 50 crédits",
      purchaseAmountCents: 5000,
      paidCreditsCents: 5000,
      salesChannels: ["ONLINE"],
      displayOrder: 1,
    });

    expect(pack.active).toBe(true);
    const all = await service.listAll();
    expect(all.some((p) => p.id === pack.id)).toBe(true);

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "CreditPack", targetId: pack.id });
    expect(entries[0]!.action).toBe("CREDIT_PACK_CREATED");
  });

  it("updates a credit pack's price, recording before/after", async () => {
    const service = buildService();
    const pack = await service.create(actorUserId, {
      name: "Pack à ajuster",
      purchaseAmountCents: 3000,
      paidCreditsCents: 3000,
      salesChannels: ["ONLINE"],
      displayOrder: 2,
    });

    const updated = await service.update(actorUserId, pack.id, { purchaseAmountCents: 3500, paidCreditsCents: 3500 });
    expect(updated.purchaseAmountCents).toBe(3500);

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "CreditPack", targetId: pack.id });
    const updateEntry = entries.find((e) => e.action === "CREDIT_PACK_UPDATED");
    expect((updateEntry!.metadata as { before: { purchaseAmountCents: number } }).before.purchaseAmountCents).toBe(3000);
  });

  it("deactivates a credit pack without deleting it", async () => {
    const service = buildService();
    const pack = await service.create(actorUserId, {
      name: "Pack obsolète",
      purchaseAmountCents: 1000,
      paidCreditsCents: 1000,
      salesChannels: ["ONLINE"],
      displayOrder: 3,
    });

    const deactivated = await service.deactivate(actorUserId, pack.id, "remplacé par un nouveau pack");
    expect(deactivated.active).toBe(false);
    expect((await service.listAll()).some((p) => p.id === pack.id)).toBe(true);
  });

  it("rejects updating an unknown credit pack", async () => {
    const service = buildService();
    await expect(service.update(actorUserId, "00000000-0000-0000-0000-000000000000", { displayOrder: 9 })).rejects.toMatchObject({ httpStatus: 404 });
  });
});
