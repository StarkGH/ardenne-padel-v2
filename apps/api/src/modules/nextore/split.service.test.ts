import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { NextoreCatalogRepository } from "./catalog.repository.js";
import { NextoreCatalogService } from "./catalog.service.js";
import { NextoreAccountsRepository } from "./accounts.repository.js";
import { NextoreAccountsService } from "./accounts.service.js";
import { NextorePaymentsRepository } from "./payments.repository.js";
import { NextorePaymentsService } from "./payments.service.js";
import { NextoreSplitService } from "./split.service.js";
import { WalletRepository } from "../wallet/wallet.repository.js";
import { WalletService } from "../wallet/wallet.service.js";
import { AuditLogService } from "../admin/audit-log.service.js";
import { AuditLogRepository } from "../admin/audit-log.repository.js";

describe("NextoreSplitService (CDC Nextore §13 — split égal/libre, SPL-*)", () => {
  let prisma: PrismaClient;
  let catalogService: NextoreCatalogService;
  let accountsService: NextoreAccountsService;
  let paymentsService: NextorePaymentsService;
  let splitService: NextoreSplitService;
  let operatorUserId: string;
  let cocaId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const auditLog = new AuditLogService(new AuditLogRepository(prisma));
    catalogService = new NextoreCatalogService(new NextoreCatalogRepository(prisma));
    const accountsRepo = new NextoreAccountsRepository(prisma);
    const paymentsRepo = new NextorePaymentsRepository(prisma);
    accountsService = new NextoreAccountsService(accountsRepo, new NextoreCatalogRepository(prisma), paymentsRepo, auditLog);
    const walletService = new WalletService(new WalletRepository(prisma));
    paymentsService = new NextorePaymentsService(paymentsRepo, accountsRepo, accountsService, walletService, auditLog);
    splitService = new NextoreSplitService(accountsRepo, accountsService, paymentsRepo);

    const operator = await prisma.user.create({
      data: { email: `staff-${randomUUID()}@example.com`, passwordHash: "x", firstName: "S", lastName: "T", role: "STAFF", status: "ACTIVE" },
    });
    operatorUserId = operator.id;

    const category = await catalogService.createCategory({ label: "Bar" });
    const coca = await catalogService.createArticle({ code: "COCA", label: "Coca", categoryId: category.id, priceCents: 200, vatRatePercent: 21 });
    cocaId = coca.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("SPL-001/002 — splits 100 cents into 3 shares with the residual on the first shares", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Groupe" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 5, operatorUserId }); // 1000 cents

    const shares = await splitService.previewEqualSplit(account.id, 3);
    expect(shares.map((s) => s.amountCents)).toEqual([334, 333, 333]);
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(1000);
  });

  it("CT-02 — split mixte : chaque part est payée indépendamment, par un moyen différent (SPL-003)", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 3 personnes" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 30, operatorUserId }); // 6000 = 60€
    const a = await accountsService.addParticipant({ accountId: account.id, displayName: "A" });
    const b = await accountsService.addParticipant({ accountId: account.id, displayName: "B" });
    const c = await accountsService.addParticipant({ accountId: account.id, displayName: "C" });

    const shares = await splitService.previewEqualSplit(account.id, 3);
    expect(shares.every((s) => s.amountCents === 2000)).toBe(true);

    await paymentsService.recordPayment({ accountId: account.id, participantId: a.id, amountCents: 2000, method: "CASH", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });
    await paymentsService.recordPayment({ accountId: account.id, participantId: b.id, amountCents: 2000, method: "CASH", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });
    await paymentsService.recordPayment({ accountId: account.id, participantId: c.id, amountCents: 2000, method: "CARD", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });

    const due = await accountsService.getDueTotalCents(account.id);
    expect(due).toBe(0);

    // Les lignes n'ont pas été affectées à un participant précis ici (split
    // sur le total du compte) : elles restent dans le bucket "non affecté",
    // que les 3 paiements par participant règlent malgré tout au global.
    const summary = await splitService.getParticipantsSummary(account.id);
    expect(summary).toHaveLength(4);
    const participantSummaries = summary.filter((s) => s.participantId !== null);
    expect(participantSummaries).toHaveLength(3);
    expect(participantSummaries.every((s) => s.status === "SETTLED")).toBe(true);
  });

  it("SPL-004 — free-amount split payment not tied to an equal share", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 10, operatorUserId }); // 2000
    const payment = await paymentsService.recordPayment({
      accountId: account.id,
      amountCents: 750,
      method: "CASH",
      idempotencyKey: randomUUID(),
      recordedByUserId: operatorUserId,
    });
    expect(payment.amountCents).toBe(750);
    const due = await accountsService.getDueTotalCents(account.id);
    expect(due).toBe(1250);
  });

  it("SPL-006 — an overpayment is surfaced as changeCents, never silently absorbed", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 5, operatorUserId }); // due = 1000 (10€)
    const payment = await paymentsService.recordPayment({
      accountId: account.id,
      amountCents: 1500,
      method: "CASH",
      idempotencyKey: randomUUID(),
      recordedByUserId: operatorUserId,
    });
    expect((payment as { changeCents: number }).changeCents).toBe(500);
  });

  it("CT-04/SPL-007 — a settled participant who leaves stays SETTLED even after new unrelated lines are added", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Groupe" });
    const p1 = await accountsService.addParticipant({ accountId: account.id, displayName: "Alice" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, participantId: p1.id, quantity: 1, operatorUserId }); // 200
    await paymentsService.recordPayment({ accountId: account.id, participantId: p1.id, amountCents: 200, method: "CASH", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });
    await accountsService.removeParticipant(p1.id);

    const p2 = await accountsService.addParticipant({ accountId: account.id, displayName: "Bob" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, participantId: p2.id, quantity: 3, operatorUserId });

    const summary = await splitService.getParticipantsSummary(account.id);
    const aliceSummary = summary.find((s) => s.participantId === p1.id)!;
    expect(aliceSummary.status).toBe("SETTLED");
    expect(aliceSummary.consumptionCents).toBe(200); // inchangé par les lignes ajoutées après son départ
  });
});
