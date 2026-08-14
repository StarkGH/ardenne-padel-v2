import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { WalletRepository } from "../wallet/wallet.repository.js";
import { WalletService } from "../wallet/wallet.service.js";
import { AuditLogRepository } from "./audit-log.repository.js";
import { AuditLogService } from "./audit-log.service.js";
import { ClientNoteRepository } from "./client-note.repository.js";
import { CrmRepository } from "./crm.repository.js";
import { CrmService } from "./crm.service.js";

/** CDC §40 — fiche client admin, agrégée depuis plusieurs domaines sans jamais exposer de donnée carte sensible. */
describe("CrmService", () => {
  const prisma = new PrismaClient();
  let actorUserId: string;
  let clientUserId: string;

  afterAll(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    const actor = await prisma.user.create({
      data: { email: `crm-actor-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "Staff", lastName: "Member", status: "ACTIVE", role: "STAFF" },
    });
    actorUserId = actor.id;
    const client = await prisma.user.create({
      data: { email: `client-searchable-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", firstName: "Jean", lastName: "Dupont", status: "ACTIVE" },
    });
    clientUserId = client.id;
  });

  function buildService() {
    return new CrmService(
      new CrmRepository(prisma),
      new WalletRepository(prisma),
      new ClientNoteRepository(prisma),
      new AuditLogService(new AuditLogRepository(prisma)),
      prisma,
    );
  }

  it("finds a client by a partial, case-insensitive match on name or e-mail", async () => {
    const service = buildService();
    const results = await service.search("dupont");
    expect(results.some((u) => u.id === clientUserId)).toBe(true);
  });

  it("returns a client file with no wallet section when the client never opened one", async () => {
    const service = buildService();
    const file = await service.getClientFile(clientUserId);

    expect(file.profile.id).toBe(clientUserId);
    expect(file.wallet).toBeNull();
    expect(file.legacyStatus.origin).toBe("V2_ONLY");
    expect(file.bookings.future).toEqual([]);
    expect(file.bookings.past).toEqual([]);
  });

  it("includes wallet balance and composition once the client has an account", async () => {
    const walletService = new WalletService(new WalletRepository(prisma));
    const wallet = await walletService.ensureAccount(clientUserId);
    await walletService.creditFromPackPurchase({ walletAccountId: wallet.id, creditPackPurchaseId: "seed", paidCreditsCents: 3000, bonusCreditsCents: 500 });

    const service = buildService();
    const file = await service.getClientFile(clientUserId);

    expect(file.wallet).not.toBeNull();
    expect(file.wallet!.balanceTotalCents).toBe(3500);
    expect(file.wallet!.balanceByOrigin.PAID).toBe(3000);
    expect(file.wallet!.balanceByOrigin.BONUS).toBe(500);
  });

  it("rejects fetching an unknown client", async () => {
    const service = buildService();
    await expect(service.getClientFile("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ httpStatus: 404 });
  });

  it("adds an administrative note, auditing it", async () => {
    const service = buildService();
    const note = await service.addNote(clientUserId, actorUserId, "Client fidèle, prévenu pour le changement d'horaire.");

    const file = await service.getClientFile(clientUserId);
    expect(file.notes).toHaveLength(1);
    expect(file.notes[0]!.body).toBe(note.body);
    expect(file.notes[0]!.authorUserId).toBe(actorUserId);

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "User", targetId: clientUserId });
    expect(entries.some((e) => e.action === "CLIENT_NOTE_ADDED")).toBe(true);
  });

  it("changes a user's role, recording before/after (CDC §58)", async () => {
    const service = buildService();
    const result = await service.changeRole(actorUserId, clientUserId, "STAFF", "promotion accueil");
    expect(result.role).toBe("STAFF");

    const auditRepo = new AuditLogRepository(prisma);
    const entries = await auditRepo.listRecent({ targetType: "User", targetId: clientUserId });
    const roleEntry = entries.find((e) => e.action === "USER_ROLE_CHANGED");
    expect(roleEntry).toBeTruthy();
    const metadata = roleEntry!.metadata as { before: { role: string }; after: { role: string } };
    expect(metadata.before.role).toBe("CUSTOMER");
    expect(metadata.after.role).toBe("STAFF");
  });
});
