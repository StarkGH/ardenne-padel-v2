import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { WalletRepository } from "./wallet.repository.js";
import { InsufficientWalletBalanceError, WalletService } from "./wallet.service.js";

describe("WalletService (CDC §28 — ledger append-only, jamais balance += x)", () => {
  let prisma: PrismaClient;
  let service: WalletService;
  let walletAccountId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    service = new WalletService(new WalletRepository(prisma));

    const user = await prisma.user.create({
      data: { email: `wallet-${randomUUID()}@example.com`, passwordHash: "x", firstName: "W", lastName: "T", status: "ACTIVE" },
    });
    const account = await service.ensureAccount(user.id);
    walletAccountId = account.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("starts at a zero balance", async () => {
    const balance = await service.getBalance(walletAccountId);
    expect(balance).toEqual({ totalCents: 0, reservedCents: 0, availableCents: 0, byOrigin: { PAID: 0, BONUS: 0, ADMIN_COMP: 0 } });
  });

  it("credits paid and bonus credits as separate ledger entries (never merged)", async () => {
    await service.creditFromPackPurchase({ walletAccountId, creditPackPurchaseId: "pack-1", paidCreditsCents: 10000, bonusCreditsCents: 2000 });
    const balance = await service.getBalance(walletAccountId);
    expect(balance.totalCents).toBe(12000);
    expect(balance.byOrigin.PAID).toBe(10000);
    expect(balance.byOrigin.BONUS).toBe(2000);
  });

  it("debits bonus credits before paid credits", async () => {
    await service.creditFromPackPurchase({ walletAccountId, creditPackPurchaseId: "pack-1", paidCreditsCents: 10000, bonusCreditsCents: 2000 });
    await service.debitForBooking({ walletAccountId, bookingId: "booking-1", amountCents: 3000 });

    const balance = await service.getBalance(walletAccountId);
    expect(balance.totalCents).toBe(9000);
    expect(balance.byOrigin.BONUS).toBe(0); // les 2000 de bonus consommés en premier
    expect(balance.byOrigin.PAID).toBe(9000); // puis 1000 pris sur le payé
  });

  it("rejects a debit larger than the available balance, writing nothing", async () => {
    await service.creditFromPackPurchase({ walletAccountId, creditPackPurchaseId: "pack-1", paidCreditsCents: 1000, bonusCreditsCents: 0 });
    await expect(service.debitForBooking({ walletAccountId, bookingId: "booking-1", amountCents: 5000 })).rejects.toThrow(
      InsufficientWalletBalanceError,
    );
    const balance = await service.getBalance(walletAccountId);
    expect(balance.totalCents).toBe(1000); // rien débité
  });

  it("reserves credits with a hold without spending them", async () => {
    await service.creditFromPackPurchase({ walletAccountId, creditPackPurchaseId: "pack-1", paidCreditsCents: 5000, bonusCreditsCents: 0 });
    const hold = await service.createHold({ walletAccountId, bookingId: "booking-1", amountCents: 2000 });

    const balance = await service.getBalance(walletAccountId);
    expect(balance.totalCents).toBe(5000); // toujours possédé
    expect(balance.reservedCents).toBe(2000);
    expect(balance.availableCents).toBe(3000); // seul le disponible diminue

    await service.releaseHold(hold.id);
    const afterRelease = await service.getBalance(walletAccountId);
    expect(afterRelease.reservedCents).toBe(0);
    expect(afterRelease.availableCents).toBe(5000); // rien dépensé
  });

  it("converts a captured hold into a real debit", async () => {
    await service.creditFromPackPurchase({ walletAccountId, creditPackPurchaseId: "pack-1", paidCreditsCents: 5000, bonusCreditsCents: 0 });
    const hold = await service.createHold({ walletAccountId, bookingId: "booking-1", amountCents: 2000 });
    await service.captureHold(hold.id);

    const balance = await service.getBalance(walletAccountId);
    expect(balance.totalCents).toBe(3000); // réellement dépensé
    expect(balance.reservedCents).toBe(0);
    expect(balance.availableCents).toBe(3000);
  });

  it("never captures or releases the same hold twice (CDC §47.2.bis)", async () => {
    await service.creditFromPackPurchase({ walletAccountId, creditPackPurchaseId: "pack-1", paidCreditsCents: 5000, bonusCreditsCents: 0 });
    const hold = await service.createHold({ walletAccountId, bookingId: "booking-1", amountCents: 2000 });

    await service.captureHold(hold.id);
    await service.captureHold(hold.id); // second appel : no-op silencieux, pas de double débit
    await service.releaseHold(hold.id); // déjà capturé : no-op aussi

    const balance = await service.getBalance(walletAccountId);
    expect(balance.totalCents).toBe(3000); // un seul débit de 2000, pas deux
  });

  it("refunds the exact origin composition on a full refund", async () => {
    await service.creditFromPackPurchase({ walletAccountId, creditPackPurchaseId: "pack-1", paidCreditsCents: 8000, bonusCreditsCents: 2000 });
    await service.debitForBooking({ walletAccountId, bookingId: "booking-1", amountCents: 5000 }); // 2000 bonus + 3000 payé

    await service.refundForBooking({ walletAccountId, bookingId: "booking-1", amountCents: 5000 });

    const balance = await service.getBalance(walletAccountId);
    expect(balance.byOrigin.BONUS).toBe(2000); // restitué
    expect(balance.byOrigin.PAID).toBe(8000); // restitué
    expect(balance.totalCents).toBe(10000); // comme avant le débit
  });

  it("refunds proportionally to the consumed composition on a partial refund", async () => {
    await service.creditFromPackPurchase({ walletAccountId, creditPackPurchaseId: "pack-1", paidCreditsCents: 8000, bonusCreditsCents: 2000 });
    await service.debitForBooking({ walletAccountId, bookingId: "booking-1", amountCents: 5000 }); // 2000 bonus + 3000 payé

    await service.refundForBooking({ walletAccountId, bookingId: "booking-1", amountCents: 2500 }); // moitié

    const balance = await service.getBalance(walletAccountId);
    // 2500/5000 = 50% -> 1000 bonus + 1500 payé restitués (proportionnel à 2000/3000 consommés)
    expect(balance.byOrigin.BONUS).toBe(0 + 1000);
    expect(balance.byOrigin.PAID).toBe(5000 + 1500);
  });

  it("rejects refunding more than what was actually debited for that booking", async () => {
    await service.creditFromPackPurchase({ walletAccountId, creditPackPurchaseId: "pack-1", paidCreditsCents: 5000, bonusCreditsCents: 0 });
    await service.debitForBooking({ walletAccountId, bookingId: "booking-1", amountCents: 3000 });

    await expect(service.refundForBooking({ walletAccountId, bookingId: "booking-1", amountCents: 4000 })).rejects.toThrow();
  });

  it("credits an admin adjustment with a traceable actor and reason", async () => {
    const admin = await prisma.user.create({
      data: { email: `admin-${randomUUID()}@example.com`, passwordHash: "x", firstName: "A", lastName: "D", status: "ACTIVE", role: "ADMIN" },
    });
    await service.creditAdmin({ walletAccountId, amountCents: 1000, createdBy: admin.id, reason: "geste commercial" });
    const balance = await service.getBalance(walletAccountId);
    expect(balance.byOrigin.ADMIN_COMP).toBe(1000);
  });
});
