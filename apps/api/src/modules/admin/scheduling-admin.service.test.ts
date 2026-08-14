import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { AuditLogRepository } from "./audit-log.repository.js";
import { AuditLogService } from "./audit-log.service.js";
import { SchedulingAdminRepository } from "./scheduling-admin.repository.js";
import { SchedulingAdminService } from "./scheduling-admin.service.js";

/** CDC §10.1, §11.1, §39.2 — configuration tarifs/horaires/fermetures, chaque mutation auditée (§58). */
describe("SchedulingAdminService", () => {
  const prisma = new PrismaClient();
  let courtId: string;
  let actorUserId: string;

  beforeAll(async () => {
    const court = await prisma.court.upsert({
      where: { slug: "test-padel-scheduling-admin" },
      update: {},
      create: { slug: "test-padel-scheduling-admin", name: "Test Padel Scheduling Admin", courtType: "DOUBLE", capacity: 4, displayOrder: 95 },
    });
    courtId = court.id;
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.court.delete({ where: { id: courtId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.tariffRule.deleteMany({ where: { courtId } });
    await prisma.openingRule.deleteMany({ where: { courtId } });
    await prisma.courtClosure.deleteMany({ where: { courtId } });
    const user = await prisma.user.create({
      data: { email: `sched-admin-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "S", lastName: "A", status: "ACTIVE", role: "ADMIN" },
    });
    actorUserId = user.id;
  });

  function buildService() {
    return new SchedulingAdminService(new SchedulingAdminRepository(prisma), new AuditLogService(new AuditLogRepository(prisma)));
  }

  it("creates a tariff rule and records an audited TARIFF_RULE_CREATED entry", async () => {
    const service = buildService();
    const rule = await service.createTariffRule(actorUserId, {
      name: "Tarif été",
      courtId,
      validFrom: "2026-06-01T00:00:00.000Z",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: "00:00",
      endTime: "23:59",
      durationMinutes: 60,
      priceTotalCents: 5200,
      referenceCapacity: 4,
      priority: 20,
    });

    expect(rule.priceTotalCents).toBe(5200);
    const rules = await service.listTariffRules(courtId);
    expect(rules.some((r) => r.id === rule.id)).toBe(true);

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "TariffRule", targetId: rule.id });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("TARIFF_RULE_CREATED");
  });

  it("deactivates a tariff rule, keeps it listed (inactive) and records before/after", async () => {
    const service = buildService();
    const rule = await service.createTariffRule(actorUserId, {
      name: "Tarif à retirer",
      courtId,
      validFrom: "2026-01-01T00:00:00.000Z",
      daysOfWeek: [1],
      startTime: "08:00",
      endTime: "10:00",
      durationMinutes: 60,
      priceTotalCents: 4000,
      referenceCapacity: 4,
      priority: 5,
    });

    const deactivated = await service.deactivateTariffRule(actorUserId, rule.id, "erreur de saisie");
    expect(deactivated.active).toBe(false);

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "TariffRule", targetId: rule.id });
    expect(entries.some((e) => e.action === "TARIFF_RULE_DEACTIVATED" && e.reason === "erreur de saisie")).toBe(true);
  });

  it("rejects deactivating an unknown tariff rule", async () => {
    const service = buildService();
    await expect(service.deactivateTariffRule(actorUserId, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ httpStatus: 404 });
  });

  it("creates and lists opening rules for a court", async () => {
    const service = buildService();
    await service.createOpeningRule(actorUserId, { courtId, dayOfWeek: 1, startTime: "08:00", endTime: "22:00", validFrom: "2026-01-01T00:00:00.000Z" });

    const rules = await service.listOpeningRules(courtId);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.dayOfWeek).toBe(1);
  });

  it("creates and deletes a court closure, auditing both", async () => {
    const service = buildService();
    const closure = await service.createCourtClosure(actorUserId, {
      courtId,
      startAt: "2026-07-14T08:00:00.000Z",
      endAt: "2026-07-14T18:00:00.000Z",
      reason: "maintenance filet",
      closureType: "MAINTENANCE",
    });
    expect((await service.listCourtClosures(courtId)).some((c) => c.id === closure.id)).toBe(true);

    await service.deleteCourtClosure(actorUserId, closure.id, "filet réparé plus tôt");
    expect((await service.listCourtClosures(courtId)).some((c) => c.id === closure.id)).toBe(false);

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "CourtClosure", targetId: closure.id });
    expect(entries.map((e) => e.action).sort()).toEqual(["COURT_CLOSURE_CREATED", "COURT_CLOSURE_DELETED"]);
  });
});
