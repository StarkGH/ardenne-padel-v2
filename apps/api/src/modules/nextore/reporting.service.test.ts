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
import { NextoreReportingRepository } from "./reporting.repository.js";
import { NextoreReportingService } from "./reporting.service.js";
import { WalletRepository } from "../wallet/wallet.repository.js";
import { WalletService } from "../wallet/wallet.service.js";
import { AuditLogService } from "../admin/audit-log.service.js";
import { AuditLogRepository } from "../admin/audit-log.repository.js";

describe("NextoreReportingService (CDC Nextore §33 — reporting opérationnel)", () => {
  let prisma: PrismaClient;
  let reportingService: NextoreReportingService;
  let catalogService: NextoreCatalogService;
  let accountsService: NextoreAccountsService;
  let paymentsService: NextorePaymentsService;
  let operatorUserId: string;
  let cocaId: string;
  let beerId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const auditLog = new AuditLogService(new AuditLogRepository(prisma));
    reportingService = new NextoreReportingService(new NextoreReportingRepository(prisma));
    catalogService = new NextoreCatalogService(new NextoreCatalogRepository(prisma));
    const accountsRepo = new NextoreAccountsRepository(prisma);
    const paymentsRepo = new NextorePaymentsRepository(prisma);
    accountsService = new NextoreAccountsService(accountsRepo, new NextoreCatalogRepository(prisma), paymentsRepo, auditLog);
    const walletService = new WalletService(new WalletRepository(prisma));
    paymentsService = new NextorePaymentsService(
      paymentsRepo,
      accountsRepo,
      accountsService,
      walletService,
      auditLog,
      new NextoreCashSessionRepository(prisma),
    );

    const operator = await prisma.user.create({
      data: { email: `staff-${randomUUID()}@example.com`, passwordHash: "x", firstName: "S", lastName: "T", role: "STAFF", status: "ACTIVE" },
    });
    operatorUserId = operator.id;

    const category = await catalogService.createCategory({ label: "Bar" });
    const coca = await catalogService.createArticle({ code: "COCA", label: "Coca", categoryId: category.id, priceCents: 280, vatRatePercent: 21 });
    const beer = await catalogService.createArticle({ code: "BIERE", label: "Bière", categoryId: category.id, priceCents: 350, vatRatePercent: 21 });
    cocaId = coca.id;
    beerId = beer.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("aggregates sales by day, article and category, matching the actual lines sold", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 2, operatorUserId }); // 560
    await accountsService.addLine({ accountId: account.id, articleId: beerId, quantity: 1, operatorUserId }); // 350

    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();

    const byDay = await reportingService.salesByDay(from, to);
    const totalDay = byDay.reduce((sum, r) => sum + r.amountCents, 0);
    expect(totalDay).toBe(910);

    const byArticle = await reportingService.salesByArticle(from, to);
    expect(byArticle).toHaveLength(2);
    expect(byArticle.find((r) => r.articleId === cocaId)?.amountCents).toBe(560);

    const byCategory = await reportingService.salesByCategory(from, to);
    expect(byCategory).toHaveLength(1);
    expect(byCategory[0]!.amountCents).toBe(910);
  });

  it("aggregates sales by VAT rate", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 1, operatorUserId });
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const rows = await reportingService.salesByVatRate(from, to);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.vatRatePercent)).toBe(21);
    expect(rows[0]!.amountTtcCents).toBe(280);
  });

  it("aggregates encashments by payment method, excluding non-RECORDED payments", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 3, operatorUserId }); // 840
    await paymentsService.recordPayment({ accountId: account.id, amountCents: 560, method: "CASH", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });
    const cardPayment = await paymentsService.recordPayment({ accountId: account.id, amountCents: 280, method: "CARD", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });
    await paymentsService.reversePayment({ paymentId: cardPayment.id, reason: "Erreur", reversedByUserId: operatorUserId });

    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const rows = await reportingService.paymentsByMethod(from, to);
    expect(rows).toEqual([{ method: "CASH", amountCents: 560, count: 1 }]); // le paiement carte annulé n'apparaît pas
  });

  it("ACC-005 — lists open accounts and flags stale ones", async () => {
    await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    const open = await reportingService.listOpenAccounts();
    expect(open).toHaveLength(1);

    // Un compte qui vient d'ouvrir n'est jamais "ancien" à un seuil de 24h.
    const stale = await reportingService.listStaleOpenAccounts(24);
    expect(stale).toHaveLength(0);
  });

  it("reports voided lines and reversed payments (annulations)", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    const line = await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 1, operatorUserId });
    await accountsService.voidLine({ lineId: line.id, reason: "Erreur de saisie", voidedByUserId: operatorUserId });

    const account2 = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 2" });
    await accountsService.addLine({ accountId: account2.id, articleId: cocaId, quantity: 1, operatorUserId });
    const payment = await paymentsService.recordPayment({ accountId: account2.id, amountCents: 280, method: "CASH", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });
    await paymentsService.reversePayment({ paymentId: payment.id, reason: "Double encaissement", reversedByUserId: operatorUserId });

    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const voided = await reportingService.voidedLines(from, to);
    expect(voided).toHaveLength(1);
    const reversed = await reportingService.reversedPayments(from, to);
    expect(reversed).toHaveLength(1);
  });
});
