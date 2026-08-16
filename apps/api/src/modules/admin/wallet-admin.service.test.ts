import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { WalletRepository } from "../wallet/wallet.repository.js";
import { WalletService } from "../wallet/wallet.service.js";
import { AuditLogRepository } from "./audit-log.repository.js";
import { AuditLogService } from "./audit-log.service.js";
import { WalletAdminService } from "./wallet-admin.service.js";

/** CDC §55 écrans 10-11-14 — crédit/débit avec motif, holds, chaque mutation auditée (§58). */
describe("WalletAdminService", () => {
  const prisma = new PrismaClient();
  let userId: string;
  let actorUserId: string;
  let walletAccountId: string;

  beforeAll(() => {
    /* rien à seeder au niveau base une fois pour toutes */
  });

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const user = await prisma.user.create({
      data: { email: `wallet-admin-user-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "W", lastName: "U", status: "ACTIVE" },
    });
    userId = user.id;
    const actor = await prisma.user.create({
      data: { email: `wallet-admin-actor-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "A", lastName: "D", status: "ACTIVE", role: "ADMIN" },
    });
    actorUserId = actor.id;
    const account = await prisma.walletAccount.create({ data: { userId } });
    walletAccountId = account.id;
  });

  function buildService() {
    const walletRepo = new WalletRepository(prisma);
    return new WalletAdminService(new WalletService(walletRepo), walletRepo, new AuditLogService(new AuditLogRepository(prisma)));
  }

  it("credits a wallet with a reason, audited", async () => {
    const service = buildService();
    await service.credit(actorUserId, walletAccountId, 5000, "geste commercial, retard club");

    const walletRepo = new WalletRepository(prisma);
    const balance = await new WalletService(walletRepo).getBalance(walletAccountId);
    expect(balance.availableCents).toBe(5000);
    expect(balance.byOrigin.ADMIN_COMP).toBe(5000);

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "WalletAccount", targetId: walletAccountId });
    expect(entries.some((e) => e.action === "WALLET_ADMIN_CREDIT")).toBe(true);
  });

  it("debits a wallet with a reason, audited, refusing to overdraw", async () => {
    const service = buildService();
    await service.credit(actorUserId, walletAccountId, 3000, "correction");

    await service.debit(actorUserId, walletAccountId, 1000, "erreur de crédit initiale");
    const walletRepo = new WalletRepository(prisma);
    const balance = await new WalletService(walletRepo).getBalance(walletAccountId);
    expect(balance.availableCents).toBe(2000);

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "WalletAccount", targetId: walletAccountId });
    expect(entries.some((e) => e.action === "WALLET_ADMIN_DEBIT")).toBe(true);

    await expect(service.debit(actorUserId, walletAccountId, 999_999, "trop")).rejects.toMatchObject({ code: "INSUFFICIENT_WALLET_BALANCE" });
  });

  it("lists holds regardless of status, and releases/captures with audit", async () => {
    const walletRepo = new WalletRepository(prisma);
    const walletService = new WalletService(walletRepo);
    await walletService.creditAdmin({ walletAccountId, amountCents: 5000, createdBy: actorUserId, reason: "seed" });
    const hold = await walletService.createHold({ walletAccountId, bookingId: "00000000-0000-0000-0000-000000000000", amountCents: 2000 });

    const service = buildService();
    const holdsBefore = await service.listHolds(walletAccountId);
    expect(holdsBefore).toHaveLength(1);
    expect(holdsBefore[0]!.status).toBe("ACTIVE");

    await service.releaseHold(actorUserId, hold.id, "réservation annulée");
    const holdsAfter = await service.listHolds(walletAccountId);
    expect(holdsAfter[0]!.status).toBe("RELEASED");

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "WalletHold", targetId: hold.id });
    expect(entries.some((e) => e.action === "WALLET_HOLD_RELEASED_ADMIN")).toBe(true);
  });

  it("lists transactions for a wallet account", async () => {
    const service = buildService();
    await service.credit(actorUserId, walletAccountId, 1500, "test");
    const transactions = await service.listTransactions(walletAccountId);
    expect(transactions.some((t) => t.type === "CREDIT_ADMIN")).toBe(true);
  });
});
