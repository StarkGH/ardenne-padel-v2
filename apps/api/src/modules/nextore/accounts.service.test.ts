import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { NextoreCatalogRepository } from "./catalog.repository.js";
import { NextoreCatalogService } from "./catalog.service.js";
import { NextoreAccountsRepository } from "./accounts.repository.js";
import { AccountVersionConflictError, NextoreAccountsService } from "./accounts.service.js";
import { NextorePaymentsRepository } from "./payments.repository.js";
import { AuditLogService } from "../admin/audit-log.service.js";
import { AuditLogRepository } from "../admin/audit-log.repository.js";

describe("NextoreAccountsService (CDC Nextore §10/§11 — comptes, participants, lignes)", () => {
  let prisma: PrismaClient;
  let catalogService: NextoreCatalogService;
  let accountsService: NextoreAccountsService;
  let operatorUserId: string;
  let cocaId: string;
  let beerId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    catalogService = new NextoreCatalogService(new NextoreCatalogRepository(prisma));
    accountsService = new NextoreAccountsService(
      new NextoreAccountsRepository(prisma),
      new NextoreCatalogRepository(prisma),
      new NextorePaymentsRepository(prisma),
      new AuditLogService(new AuditLogRepository(prisma)),
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

  it("opens an ephemeral account with a free label (ACC-003/004)", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 3" });
    expect(account.status).toBe("OPEN");
    expect(account.label).toBe("Table 3");
  });

  it("rejects an account with neither a customer nor a label (ACC-001)", async () => {
    await expect(accountsService.openAccount({ openedByUserId: operatorUserId })).rejects.toThrow();
  });

  it("snapshots price at the time of sale — a later catalog price change never rewrites past lines (CAT-004)", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    const line = await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 2, operatorUserId });
    expect(line.unitPriceCentsAtSale).toBe(280);

    await catalogService.updatePrice(cocaId, 320);
    const due = await accountsService.getDueTotalCents(account.id);
    expect(due).toBe(560); // 2 x 280, pas 2 x 320
  });

  it("never physically deletes a line — voiding requires a reason and keeps it visible (COR-001/POS-007)", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    const line = await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 1, operatorUserId });

    await expect(accountsService.voidLine({ lineId: line.id, reason: "", voidedByUserId: operatorUserId })).rejects.toThrow();

    const voided = await accountsService.voidLine({ lineId: line.id, reason: "Erreur de saisie", voidedByUserId: operatorUserId });
    expect(voided.status).toBe("VOIDED");
    const due = await accountsService.getDueTotalCents(account.id);
    expect(due).toBe(0);
  });

  it("CT-04 — a participant who leaves is never charged for lines added afterwards", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Groupe" });
    const p1 = await accountsService.addParticipant({ accountId: account.id, displayName: "Alice" });
    const p2 = await accountsService.addParticipant({ accountId: account.id, displayName: "Bob" });

    await accountsService.addLine({ accountId: account.id, articleId: beerId, participantId: p1.id, quantity: 1, operatorUserId });
    await accountsService.removeParticipant(p1.id);

    await expect(
      accountsService.addLine({ accountId: account.id, articleId: beerId, participantId: p1.id, quantity: 3, operatorUserId }),
    ).rejects.toThrow();

    // Les nouvelles lignes vont bien au participant restant.
    const line = await accountsService.addLine({ accountId: account.id, articleId: beerId, participantId: p2.id, quantity: 3, operatorUserId });
    expect(line.participantId).toBe(p2.id);
  });

  it("refuses to close an account with an outstanding balance (ACC-008)", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.addLine({ accountId: account.id, articleId: cocaId, quantity: 1, operatorUserId });

    await expect(
      accountsService.closeAccount({ accountId: account.id, expectedVersion: account.version, closedByUserId: operatorUserId }),
    ).rejects.toThrow();
  });

  it("closes a fully-voided (zero-due) account and rejects a stale version (§30.3)", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table 1" });
    await accountsService.closeAccount({ accountId: account.id, expectedVersion: account.version, closedByUserId: operatorUserId });

    // Rejouer avec la même version déjà consommée -> conflit, pas d'écrasement silencieux.
    await expect(
      accountsService.closeAccount({ accountId: account.id, expectedVersion: account.version, closedByUserId: operatorUserId }),
    ).rejects.toThrow(AccountVersionConflictError);
  });
});
