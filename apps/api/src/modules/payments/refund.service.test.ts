import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildTestNotificationService } from "../../testing/build-notification-service.js";
import { PaymentsRepository } from "./payments.repository.js";
import { RefundService } from "./refund.service.js";
import { FakePaymentProvider } from "./testing/fake-payment-provider.js";

describe("RefundService (CDC §30.1 — traçabilité des remboursements)", () => {
  let prisma: PrismaClient;
  let userId: string;
  let paymentId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: `refund-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "irrelevant",
        firstName: "Refund",
        lastName: "Test",
        status: "ACTIVE",
      },
    });
    userId = user.id;

    const payment = await prisma.payment.create({
      data: {
        user: { connect: { id: userId } },
        provider: "stripe",
        providerPaymentId: `pi_refund_test_${Date.now()}_${Math.random()}`,
        amountCents: 4800,
        purpose: "BOOKING_FULL",
        status: "SUCCEEDED",
      },
    });
    paymentId = payment.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("issues a full refund and records it with full traceability", async () => {
    const paymentProvider = new FakePaymentProvider();
    const service = new RefundService(new PaymentsRepository(prisma), paymentProvider, buildTestNotificationService(prisma));

    const refund = await service.refund({ paymentId, amountCents: 4800, reason: "client_request", createdBy: userId });

    expect(refund.amountCents).toBe(4800);
    expect(refund.status).toBe("SUCCEEDED");
    expect(refund.providerRefundId).toMatch(/^re_fake_/);
    expect(paymentProvider.refundCalls).toHaveLength(1);
  });

  it("supports a partial refund", async () => {
    const paymentProvider = new FakePaymentProvider();
    const service = new RefundService(new PaymentsRepository(prisma), paymentProvider, buildTestNotificationService(prisma));

    const refund = await service.refund({ paymentId, amountCents: 1200 });
    expect(refund.amountCents).toBe(1200);
  });

  it("rejects a refund larger than the amount actually paid", async () => {
    const paymentProvider = new FakePaymentProvider();
    const service = new RefundService(new PaymentsRepository(prisma), paymentProvider, buildTestNotificationService(prisma));

    await expect(service.refund({ paymentId, amountCents: 999999 })).rejects.toThrow();
  });

  it("rejects refunding a payment that was never captured", async () => {
    const uncaptured = await prisma.payment.create({
      data: {
        user: { connect: { id: userId } },
        provider: "stripe",
        providerPaymentId: `pi_uncaptured_${Date.now()}`,
        amountCents: 4800,
        purpose: "BOOKING_FULL",
        status: "AUTHORIZED",
      },
    });
    const paymentProvider = new FakePaymentProvider();
    const service = new RefundService(new PaymentsRepository(prisma), paymentProvider, buildTestNotificationService(prisma));

    await expect(service.refund({ paymentId: uncaptured.id, amountCents: 4800 })).rejects.toThrow();
  });
});
