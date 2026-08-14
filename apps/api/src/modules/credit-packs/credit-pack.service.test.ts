import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetIntegrationTestData } from "../../testing/reset-db.js";
import { PaymentsRepository } from "../payments/payments.repository.js";
import { FakePaymentProvider } from "../payments/testing/fake-payment-provider.js";
import { WalletRepository } from "../wallet/wallet.repository.js";
import { WalletService } from "../wallet/wallet.service.js";
import { CreditPacksRepository } from "./credit-packs.repository.js";
import { CreditPackService } from "./credit-pack.service.js";

/** CDC §28.2-§28.4 — achat de pack, validé avec un faux provider (pas de clé Stripe requise). */
describe("CreditPackService", () => {
  const prisma = new PrismaClient();
  let userId: string;
  let packId: string;
  let walletService: WalletService;

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetIntegrationTestData(prisma);
    await prisma.creditPack.deleteMany();

    const user = await prisma.user.create({
      data: { email: `packbuyer-${randomUUID()}@example.com`, passwordHash: "x", firstName: "P", lastName: "B", status: "ACTIVE" },
    });
    userId = user.id;

    const pack = await prisma.creditPack.create({
      data: {
        name: "100€ -> 100 crédits",
        purchaseAmountCents: 10000,
        paidCreditsCents: 10000,
        bonusCreditsCents: 0,
        salesChannels: ["ONLINE"],
        displayOrder: 1,
      },
    });
    packId = pack.id;

    walletService = new WalletService(new WalletRepository(prisma));
  });

  function buildService(payment: FakePaymentProvider) {
    return new CreditPackService(new CreditPacksRepository(prisma), new PaymentsRepository(prisma), walletService, payment);
  }

  it("credits the wallet exactly once for a successful synchronous purchase", async () => {
    const payment = new FakePaymentProvider();
    const service = buildService(payment);

    const result = await service.purchase({ userId, creditPackId: packId, paymentMethodId: "pm_card_visa" });
    expect(result.requiresAction).toBe(false);

    const wallet = await walletService.ensureAccount(userId);
    const balance = await walletService.getBalance(wallet.id);
    expect(balance.totalCents).toBe(10000);

    const purchase = await prisma.creditPackPurchase.findUniqueOrThrow({ where: { id: result.purchaseId } });
    expect(purchase.status).toBe("CREDITED");
  });

  it("credits both paid and bonus credits when the pack includes a bonus", async () => {
    const bonusPack = await prisma.creditPack.create({
      data: { name: "250€ + bonus", purchaseAmountCents: 25000, paidCreditsCents: 25000, bonusCreditsCents: 5000, salesChannels: ["ONLINE"], displayOrder: 2 },
    });
    const payment = new FakePaymentProvider();
    const service = buildService(payment);

    await service.purchase({ userId, creditPackId: bonusPack.id, paymentMethodId: "pm_card_visa" });

    const wallet = await walletService.ensureAccount(userId);
    const balance = await walletService.getBalance(wallet.id);
    expect(balance.byOrigin.PAID).toBe(25000);
    expect(balance.byOrigin.BONUS).toBe(5000);
  });

  it("does not credit the wallet when the card is declined", async () => {
    const payment = new FakePaymentProvider();
    payment.authorizeResult = "failed";
    const service = buildService(payment);

    await expect(service.purchase({ userId, creditPackId: packId, paymentMethodId: "pm_declined" })).rejects.toThrow();

    const wallet = await walletService.ensureAccount(userId);
    const balance = await walletService.getBalance(wallet.id);
    expect(balance.totalCents).toBe(0);
  });

  it("credits the wallet only once even if the completion is triggered twice (duplicate webhook, CDC §111)", async () => {
    const payment = new FakePaymentProvider();
    payment.authorizeResult = "requires_action";
    const service = buildService(payment);

    const result = await service.purchase({ userId, creditPackId: packId, paymentMethodId: "pm_3ds" });
    expect(result.requiresAction).toBe(true);

    const purchase = await prisma.creditPackPurchase.findUniqueOrThrow({ where: { id: result.purchaseId } });
    const providerPaymentId = purchase.paymentId ? (await prisma.payment.findUniqueOrThrow({ where: { id: purchase.paymentId } })).providerPaymentId : "";

    await service.continueAfterAuthorizationConfirmed(providerPaymentId);
    await service.continueAfterAuthorizationConfirmed(providerPaymentId); // livraison dupliquée

    const wallet = await walletService.ensureAccount(userId);
    const balance = await walletService.getBalance(wallet.id);
    expect(balance.totalCents).toBe(10000); // un seul crédit, pas deux
  });
});
