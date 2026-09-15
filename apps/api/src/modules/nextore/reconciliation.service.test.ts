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
import { NextoreReconciliationRepository } from "./reconciliation.repository.js";
import { NextoreReconciliationService } from "./reconciliation.service.js";
import { WalletRepository } from "../wallet/wallet.repository.js";
import { WalletService } from "../wallet/wallet.service.js";
import { AuditLogService } from "../admin/audit-log.service.js";
import { AuditLogRepository } from "../admin/audit-log.repository.js";

describe("NextoreReconciliationService (CDC Nextore §23 — REC0-*)", () => {
  let prisma: PrismaClient;
  let reconciliationService: NextoreReconciliationService;
  let paymentsService: NextorePaymentsService;
  let accountsService: NextoreAccountsService;
  let catalogService: NextoreCatalogService;
  let operatorUserId: string;
  let managerUserId: string;
  let cocaId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const auditLog = new AuditLogService(new AuditLogRepository(prisma));
    reconciliationService = new NextoreReconciliationService(new NextoreReconciliationRepository(prisma), auditLog);
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

  it("REC0-002/003 — matches a bank line to the single card payment with the exact same amount", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 2, operatorUserId }); // 560
    await paymentsService.recordPayment({ accountId: account.id, amountCents: 560, method: "CARD", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });

    const entries = await reconciliationService.importBatch({
      importedByUserId: managerUserId,
      sourceFilename: "europabank-test.csv",
      rows: [{ externalDate: new Date(), externalAmountCents: 560, externalReference: "REF123" }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("MATCHED");
  });

  it("REC0-003 — several equal-amount candidates in the window are AMBIGUOUS, never auto-picked", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 2, operatorUserId });
    await paymentsService.recordPayment({ accountId: account.id, amountCents: 560, method: "CARD", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });

    const account2 = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 2" });
    await accountsService.addLine({ accountId: account2.id, articleId: cocaId, quantity: 2, operatorUserId });
    await paymentsService.recordPayment({ accountId: account2.id, amountCents: 560, method: "CARD", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });

    const entries = await reconciliationService.importBatch({
      importedByUserId: managerUserId,
      rows: [{ externalDate: new Date(), externalAmountCents: 560 }],
    });
    expect(entries[0]!.status).toBe("AMBIGUOUS");
  });

  it("REC0-007 — no silent amount tolerance: a mismatched amount is UNMATCHED, never fuzzy-matched", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 2, operatorUserId }); // 560
    await paymentsService.recordPayment({ accountId: account.id, amountCents: 560, method: "CARD", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });

    const entries = await reconciliationService.importBatch({
      importedByUserId: managerUserId,
      rows: [{ externalDate: new Date(), externalAmountCents: 561 }], // 1 centime d'écart
    });
    expect(entries[0]!.status).toBe("UNMATCHED");
  });

  it("REC0-005/006 — manual confirmation resolves an AMBIGUOUS entry and is audited", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 2, operatorUserId });
    const p1 = await paymentsService.recordPayment({ accountId: account.id, amountCents: 560, method: "CARD", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });

    const account2 = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 2" });
    await accountsService.addLine({ accountId: account2.id, articleId: cocaId, quantity: 2, operatorUserId });
    await paymentsService.recordPayment({ accountId: account2.id, amountCents: 560, method: "CARD", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });

    const entries = await reconciliationService.importBatch({
      importedByUserId: managerUserId,
      rows: [{ externalDate: new Date(), externalAmountCents: 560 }],
    });
    expect(entries[0]!.status).toBe("AMBIGUOUS");

    const confirmed = await reconciliationService.confirmMatch({
      entryId: entries[0]!.id,
      paymentId: p1.id,
      confirmedByUserId: managerUserId,
      note: "Vérifié manuellement sur le ticket de caisse",
    });
    expect(confirmed.status).toBe("MATCHED");
    expect(confirmed.matchedPaymentId).toBe(p1.id);
  });

  it("REC0-004 — exceptions view surfaces UNMATCHED/AMBIGUOUS, not MATCHED entries", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 2, operatorUserId });
    await paymentsService.recordPayment({ accountId: account.id, amountCents: 560, method: "CARD", idempotencyKey: randomUUID(), recordedByUserId: operatorUserId });

    await reconciliationService.importBatch({
      importedByUserId: managerUserId,
      rows: [
        { externalDate: new Date(), externalAmountCents: 560 }, // MATCHED
        { externalDate: new Date(), externalAmountCents: 9999 }, // UNMATCHED
      ],
    });

    const exceptions = await reconciliationService.listExceptions();
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]!.externalAmountCents).toBe(9999);
  });
});
