import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { NextoreCatalogRepository } from "./catalog.repository.js";
import { NextoreAccountsRepository } from "./accounts.repository.js";
import { AccountVersionConflictError, NextoreAccountsService } from "./accounts.service.js";
import { AuditLogService } from "../admin/audit-log.service.js";
import { AuditLogRepository } from "../admin/audit-log.repository.js";

/**
 * CDC Nextore §30.3 — deux opérateurs sur le même compte : une modification
 * concurrente ne doit jamais écraser l'autre silencieusement. Requêtes
 * réellement simultanées (`Promise.allSettled`), pas séquentielles.
 */
describe("NextoreAccountsService concurrency (CDC Nextore §30.3)", () => {
  let prisma: PrismaClient;
  let accountsService: NextoreAccountsService;
  let operatorUserId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    accountsService = new NextoreAccountsService(
      new NextoreAccountsRepository(prisma),
      new NextoreCatalogRepository(prisma),
      new AuditLogService(new AuditLogRepository(prisma)),
    );
    const operator = await prisma.user.create({
      data: { email: `staff-${randomUUID()}@example.com`, passwordHash: "x", firstName: "S", lastName: "T", role: "STAFF", status: "ACTIVE" },
    });
    operatorUserId = operator.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("only one of two simultaneous close attempts on the same account version succeeds", async () => {
    const account = await accountsService.openAccount({ openedByUserId: operatorUserId, label: "Table concurrente" });

    const attempt = () =>
      accountsService.closeAccount({ accountId: account.id, expectedVersion: account.version, closedByUserId: operatorUserId });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AccountVersionConflictError);

    const finalAccount = await accountsService.getAccount(account.id);
    expect(finalAccount.status).toBe("CLOSED");
    expect(finalAccount.version).toBe(1); // incrémenté une seule fois, jamais deux
  });
});
