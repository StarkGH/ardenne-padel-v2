import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { AuditLogRepository } from "./audit-log.repository.js";
import { AuditLogService } from "./audit-log.service.js";

/** CDC §58 — journal d'audit append-only, before/after expurgé des champs sensibles. */
describe("AuditLogService", () => {
  const prisma = new PrismaClient();
  let actorUserId: string;

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const user = await prisma.user.create({
      data: { email: `admin-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "A", lastName: "D", status: "ACTIVE", role: "ADMIN" },
    });
    actorUserId = user.id;
  });

  it("records an entry with actor, action, target and timestamp", async () => {
    const service = new AuditLogService(new AuditLogRepository(prisma));
    await service.record({ actorUserId, action: "TARIFF_RULE_CREATED", targetType: "TariffRule", targetId: "rule-1", reason: "nouveau tarif été" });

    const entries = await service.listForTarget("TariffRule", "rule-1");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorUserId).toBe(actorUserId);
    expect(entries[0]!.action).toBe("TARIFF_RULE_CREATED");
    expect(entries[0]!.reason).toBe("nouveau tarif été");
    expect(entries[0]!.createdAt).toBeInstanceOf(Date);
  });

  it("redacts sensitive fields in before/after payloads (CDC §57.1)", async () => {
    const service = new AuditLogService(new AuditLogRepository(prisma));
    await service.record({
      actorUserId,
      action: "USER_ROLE_CHANGED",
      targetType: "User",
      targetId: "user-1",
      before: { role: "CUSTOMER", passwordHash: "should-never-appear" },
      after: { role: "ADMIN", deviceKeyHash: "should-never-appear-either" },
    });

    const entries = await service.listForTarget("User", "user-1");
    const metadata = entries[0]!.metadata as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(metadata.before.role).toBe("CUSTOMER");
    expect(metadata.before.passwordHash).toBe("[EXPURGE]");
    expect(metadata.after.deviceKeyHash).toBe("[EXPURGE]");
  });

  it("never exposes a delete/update method — entries are append-only", () => {
    const service = new AuditLogService(new AuditLogRepository(prisma));
    expect((service as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).delete).toBeUndefined();
  });
});
