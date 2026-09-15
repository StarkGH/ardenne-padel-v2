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
import { NextoreCashSessionRepository } from "./cash-session.repository.js";
import { CashSessionAlreadyOpenError, NextoreCashSessionService } from "./cash-session.service.js";
import { WalletRepository } from "../wallet/wallet.repository.js";
import { WalletService } from "../wallet/wallet.service.js";
import { AuditLogService } from "../admin/audit-log.service.js";
import { AuditLogRepository } from "../admin/audit-log.repository.js";

describe("NextoreCashSessionService (CDC Nextore §15 — CASH-*)", () => {
  let prisma: PrismaClient;
  let cashSessionService: NextoreCashSessionService;
  let catalogService: NextoreCatalogService;
  let accountsService: NextoreAccountsService;
  let paymentsService: NextorePaymentsService;
  let operatorUserId: string;
  let managerUserId: string;
  let cocaId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const auditLog = new AuditLogService(new AuditLogRepository(prisma));
    const cashSessionRepo = new NextoreCashSessionRepository(prisma);
    cashSessionService = new NextoreCashSessionService(cashSessionRepo, auditLog);
    catalogService = new NextoreCatalogService(new NextoreCatalogRepository(prisma));
    const accountsRepo = new NextoreAccountsRepository(prisma);
    const paymentsRepo = new NextorePaymentsRepository(prisma);
    accountsService = new NextoreAccountsService(accountsRepo, new NextoreCatalogRepository(prisma), paymentsRepo, auditLog);
    const walletService = new WalletService(new WalletRepository(prisma));
    paymentsService = new NextorePaymentsService(paymentsRepo, accountsRepo, accountsService, walletService, auditLog, cashSessionRepo);

    const operator = await prisma.user.create({
      data: { email: `staff-${randomUUID()}@example.com`, passwordHash: "x", firstName: "S", lastName: "T", role: "STAFF", status: "ACTIVE" },
    });
    operatorUserId = operator.id;
    const manager = await prisma.user.create({
      data: { email: `mgr-${randomUUID()}@example.com`, passwordHash: "x", firstName: "M", lastName: "G", role: "ADMIN", status: "ACTIVE" },
    });
    managerUserId = manager.id;

    const category = await catalogService.createCategory({ label: "Bar" });
    const coca = await catalogService.createArticle({ code: "COCA", label: "Coca", categoryId: category.id, priceCents: 280, vatRatePercent: 21 });
    cocaId = coca.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("CASH-001/002 — opens a session with a declared opening float", async () => {
    const session = await cashSessionService.openSession({ openedByUserId: operatorUserId, declaredOpeningCents: 10000 });
    expect(session.status).toBe("OPEN");
    expect(session.declaredOpeningCents).toBe(10000);
  });

  it("only one session can be open at a time", async () => {
    await cashSessionService.openSession({ openedByUserId: operatorUserId, declaredOpeningCents: 10000 });
    await expect(cashSessionService.openSession({ openedByUserId: operatorUserId, declaredOpeningCents: 5000 })).rejects.toThrow(
      CashSessionAlreadyOpenError,
    );
  });

  it("CASH-005/007 — cash payments and movements feed the theoretical closing amount", async () => {
    const session = await cashSessionService.openSession({ openedByUserId: operatorUserId, declaredOpeningCents: 10000 });

    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 2, operatorUserId }); // 560
    await paymentsService.recordPayment({ accountId: account.id, amountCents: 560, method: "CASH", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });

    // Un paiement carte ne doit pas entrer dans le théorique cash.
    const account2 = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 2" });
    await accountsService.addLine({ accountId: account2.id, articleId: cocaId, quantity: 1, operatorUserId });
    await paymentsService.recordPayment({ accountId: account2.id, amountCents: 280, method: "CARD", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });

    await cashSessionService.recordMovement({ sessionId: session.id, type: "OUT", amountCents: 2000, reason: "Dépôt banque", createdByUserId: managerUserId });

    const theoretical = await cashSessionService.getTheoreticalCashCents(session.id);
    expect(theoretical).toBe(10000 + 560 - 2000); // fond + cash uniquement (pas la carte) - sortie
  });

  it("CASH-006/008 — closing requires a justification beyond the variance threshold, never absorbed silently", async () => {
    const session = await cashSessionService.openSession({ openedByUserId: operatorUserId, declaredOpeningCents: 10000 });
    // Théorique = 10000, écart de 1000 (10€) > seuil (5€) sans justification -> refusé.
    await expect(
      cashSessionService.closeSession({ sessionId: session.id, declaredClosingCents: 11000, closedByUserId: managerUserId }),
    ).rejects.toThrow();

    const closed = await cashSessionService.closeSession({
      sessionId: session.id,
      declaredClosingCents: 11000,
      justification: "Pourboires non comptabilisés dans le fond",
      closedByUserId: managerUserId,
    });
    expect(closed.status).toBe("CLOSED");
    expect(closed.varianceCents).toBe(1000);
  });

  it("CASH-009 — a closed session cannot receive new movements", async () => {
    const session = await cashSessionService.openSession({ openedByUserId: operatorUserId, declaredOpeningCents: 10000 });
    await cashSessionService.closeSession({ sessionId: session.id, declaredClosingCents: 10000, closedByUserId: managerUserId });

    await expect(
      cashSessionService.recordMovement({ sessionId: session.id, type: "IN", amountCents: 100, reason: "Test", createdByUserId: managerUserId }),
    ).rejects.toThrow();
  });

  it("CASH-010 — the session report breaks down encashments by payment method", async () => {
    const session = await cashSessionService.openSession({ openedByUserId: operatorUserId, declaredOpeningCents: 10000 });
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 3, operatorUserId }); // 840
    await paymentsService.recordPayment({ accountId: account.id, amountCents: 560, method: "CASH", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });
    await paymentsService.recordPayment({ accountId: account.id, amountCents: 280, method: "CARD", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });

    const report = await cashSessionService.getSessionReport(session.id);
    expect(report.paymentsByMethod.CASH).toBe(560);
    expect(report.paymentsByMethod.CARD).toBe(280);
  });
});
