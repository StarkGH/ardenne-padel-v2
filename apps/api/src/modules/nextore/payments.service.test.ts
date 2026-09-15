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
import { WalletRepository } from "../wallet/wallet.repository.js";
import { WalletService, InsufficientWalletBalanceError } from "../wallet/wallet.service.js";
import { AuditLogService } from "../admin/audit-log.service.js";
import { AuditLogRepository } from "../admin/audit-log.repository.js";

describe("NextorePaymentsService (CDC Nextore §12/§26 — paiements, idempotence, contrepassation)", () => {
  let prisma: PrismaClient;
  let catalogService: NextoreCatalogService;
  let accountsService: NextoreAccountsService;
  let paymentsService: NextorePaymentsService;
  let walletService: WalletService;
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
    walletService = new WalletService(new WalletRepository(prisma));
    paymentsService = new NextorePaymentsService(paymentsRepo, accountsRepo, accountsService, walletService, auditLog, new NextoreCashSessionRepository(prisma));

    const operator = await prisma.user.create({
      data: { email: `staff-${randomUUID()}@example.com`, passwordHash: "x", firstName: "S", lastName: "T", role: "STAFF", status: "ACTIVE" },
    });
    operatorUserId = operator.id;

    const category = await catalogService.createCategory({ label: "Bar" });
    const coca = await catalogService.createArticle({ code: "COCA", label: "Coca", categoryId: category.id, priceCents: 280, vatRatePercent: 21 });
    cocaId = coca.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records a cash payment and moves the account to PARTIALLY_PAID (PAY-001/ACC-007)", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 2, operatorUserId });

    const payment = await paymentsService.recordPayment({
      accountId: account.id,
      amountCents: 560,
      method: "CASH",
      idempotencyKey: randomUUID(),
      recordedByUserId: operatorUserId,
    });
    expect(payment.status).toBe("RECORDED");

    const due = await accountsService.getDueTotalCents(account.id);
    expect(due).toBe(0);
    const refreshed = await accountsService.getAccount(account.id);
    expect(refreshed.status).toBe("PARTIALLY_PAID");
  });

  it("PAY-012/CDC §60 — a duplicate idempotencyKey never creates a second payment (double clic)", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    const key = randomUUID();
    const input = { accountId: account.id, amountCents: 500, method: "CASH" as const, idempotencyKey: key, recordedByUserId: operatorUserId };

    const [p1, p2] = await Promise.all([paymentsService.recordPayment(input), paymentsService.recordPayment(input)]);
    expect(p1.id).toBe(p2.id);

    const payments = await paymentsService.listForAccount(account.id);
    expect(payments).toHaveLength(1);
  });

  it("PAY-003/PAY-005 — pays with wallet credits, debits the ledger exactly once, and rejects insufficient balance", async () => {
    const customer = await prisma.user.create({
      data: { email: `client-${randomUUID()}@example.com`, passwordHash: "x", firstName: "C", lastName: "L", status: "ACTIVE" },
    });
    const wallet = await walletService.ensureAccount(customer.id);
    await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "pack-1", paidCreditsCents: 1000, bonusCreditsCents: 0 });

    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, customerId: customer.id });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 2, operatorUserId });

    const payment = await paymentsService.recordPayment({
      accountId: account.id,
      amountCents: 560,
      method: "WALLET_CREDIT",
      idempotencyKey: randomUUID(),
      recordedByUserId: operatorUserId,
    });
    expect(payment.status).toBe("RECORDED");

    const balance = await walletService.getBalance(wallet.id);
    expect(balance.totalCents).toBe(440); // 1000 - 560, débité une seule fois

    // Second compte, tente de payer plus que le solde restant disponible.
    const account2 = await accountsService.openAccount({ openedByUserId: operatorUserId, customerId: customer.id });
    await accountsService.addLine({ accountId: account2.id, articleId: cocaId, quantity: 5, operatorUserId }); // 1400 due, wallet n'a que 440

    await expect(
      paymentsService.recordPayment({
        accountId: account2.id,
        amountCents: 1400,
        method: "WALLET_CREDIT",
        idempotencyKey: randomUUID(),
        recordedByUserId: operatorUserId,
      }),
    ).rejects.toThrow(InsufficientWalletBalanceError);

    // Le solde n'a pas bougé après le refus (aucune écriture partielle).
    const balanceAfterFailure = await walletService.getBalance(wallet.id);
    expect(balanceAfterFailure.totalCents).toBe(440);
  });

  it("COR-002/COR-004/COR-006 — reversing a wallet-credit payment restores the ledger and never rewrites the original entry", async () => {
    const customer = await prisma.user.create({
      data: { email: `client-${randomUUID()}@example.com`, passwordHash: "x", firstName: "C", lastName: "L", status: "ACTIVE" },
    });
    const wallet = await walletService.ensureAccount(customer.id);
    await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "pack-1", paidCreditsCents: 1000, bonusCreditsCents: 0 });

    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, customerId: customer.id });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 2, operatorUserId });
    const payment = await paymentsService.recordPayment({
      accountId: account.id,
      amountCents: 560,
      method: "WALLET_CREDIT",
      idempotencyKey: randomUUID(),
      recordedByUserId: operatorUserId,
    });

    const reversed = await paymentsService.reversePayment({ paymentId: payment.id, reason: "Erreur d'encaissement", reversedByUserId: operatorUserId });
    expect(reversed.status).toBe("REVERSED");

    const balance = await walletService.getBalance(wallet.id);
    expect(balance.totalCents).toBe(1000); // restitué intégralement

    const payments = await paymentsService.listForAccount(account.id);
    expect(payments).toHaveLength(1); // pas de seconde ligne créée, l'originale est mise à jour en place
    expect(payments[0]!.status).toBe("REVERSED");
  });

  it("rejects a reversal without a reason", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    const payment = await paymentsService.recordPayment({
      accountId: account.id,
      amountCents: 500,
      method: "CASH",
      idempotencyKey: randomUUID(),
      recordedByUserId: operatorUserId,
    });
    await expect(paymentsService.reversePayment({ paymentId: payment.id, reason: "", reversedByUserId: operatorUserId })).rejects.toThrow();
  });
});
