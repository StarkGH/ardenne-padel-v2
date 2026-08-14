import { describe, expect, it, vi } from "vitest";
import type { StripeClientPort } from "./stripe-client-port.js";
import { StripePaymentProvider } from "./stripe-payment-provider.js";

function fakeClient(overrides: Partial<StripeClientPort> = {}): StripeClientPort {
  return {
    customers: { create: vi.fn().mockResolvedValue({ id: "cus_123" }) },
    setupIntents: { create: vi.fn().mockResolvedValue({ id: "seti_123", client_secret: "seti_123_secret" }) },
    paymentIntents: {
      create: vi.fn().mockResolvedValue({ id: "pi_123", status: "requires_capture", client_secret: "pi_123_secret" }),
      capture: vi.fn().mockResolvedValue({ id: "pi_123", status: "succeeded", client_secret: null }),
      cancel: vi.fn().mockResolvedValue({ id: "pi_123", status: "canceled", client_secret: null }),
      retrieve: vi.fn().mockResolvedValue({ id: "pi_123", status: "succeeded", client_secret: null }),
    },
    refunds: { create: vi.fn().mockResolvedValue({ id: "re_123", status: "succeeded" }) },
    balanceTransactions: { retrieve: vi.fn().mockResolvedValue({ id: "txn_123", fee: 74, net: 4726, currency: "eur" }) },
    webhooks: { constructEvent: vi.fn() },
    ...overrides,
  } as StripeClientPort;
}

describe("StripePaymentProvider (CDC §21.1, §2.6 — jamais de donnée carte stockée)", () => {
  it("creates a customer and returns only the provider reference", async () => {
    const client = fakeClient();
    const provider = new StripePaymentProvider(client);
    const result = await provider.createCustomer({ userId: "user-1", email: "joueur@example.com" });
    expect(result).toEqual({ customerId: "cus_123" });
    expect(client.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "joueur@example.com", metadata: { userId: "user-1" } }),
    );
  });

  it("creates a manual-capture authorization and passes an idempotency key (CDC §47.1)", async () => {
    const client = fakeClient();
    const provider = new StripePaymentProvider(client);
    const result = await provider.createPayment({
      customerId: "cus_123",
      amountCents: 4800,
      currency: "EUR",
      paymentMethodId: "pm_card_visa",
      idempotencyKey: "booking-1-authorize",
    });
    expect(result.status).toBe("requires_capture");
    expect(client.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4800, capture_method: "manual", confirm: true }),
      { idempotencyKey: "booking-1-authorize" },
    );
  });

  it("maps requires_action, succeeded, canceled and unknown statuses correctly", async () => {
    const cases: Array<[string, string]> = [
      ["requires_action", "requires_action"],
      ["processing", "requires_action"],
      ["requires_capture", "requires_capture"],
      ["succeeded", "succeeded"],
      ["canceled", "canceled"],
      ["requires_payment_method", "failed"],
    ];
    for (const [stripeStatus, expected] of cases) {
      const client = fakeClient({
        paymentIntents: {
          create: vi.fn().mockResolvedValue({ id: "pi_x", status: stripeStatus, client_secret: null }),
          capture: vi.fn(),
          cancel: vi.fn(),
          retrieve: vi.fn(),
        },
      });
      const provider = new StripePaymentProvider(client);
      const result = await provider.createPayment({
        customerId: "cus_123",
        amountCents: 100,
        currency: "EUR",
        paymentMethodId: "pm_x",
        idempotencyKey: "k",
      });
      expect(result.status).toBe(expected);
    }
  });

  it("captures an authorized payment", async () => {
    const client = fakeClient();
    const provider = new StripePaymentProvider(client);
    const result = await provider.confirmOrCapture({ providerPaymentId: "pi_123" });
    expect(result.status).toBe("succeeded");
    expect(client.paymentIntents.capture).toHaveBeenCalledWith("pi_123");
  });

  it("voids an authorization by canceling the PaymentIntent (never a refund on an uncaptured payment)", async () => {
    const client = fakeClient();
    const provider = new StripePaymentProvider(client);
    await provider.voidAuthorization({ providerPaymentId: "pi_123" });
    expect(client.paymentIntents.cancel).toHaveBeenCalledWith("pi_123");
    expect(client.refunds.create).not.toHaveBeenCalled();
  });

  it("returns null actual fee when the balance transaction is not yet available (async, CDC §30.3)", async () => {
    const client = fakeClient({
      paymentIntents: {
        create: vi.fn(),
        capture: vi.fn(),
        cancel: vi.fn(),
        retrieve: vi.fn().mockResolvedValue({ id: "pi_123", status: "succeeded", client_secret: null, latest_charge: null }),
      },
    });
    const provider = new StripePaymentProvider(client);
    const fee = await provider.getActualProviderFee({ providerPaymentId: "pi_123" });
    expect(fee).toBeNull();
  });

  it("retrieves the real provider fee from the balance transaction once available", async () => {
    const client = fakeClient({
      paymentIntents: {
        create: vi.fn(),
        capture: vi.fn(),
        cancel: vi.fn(),
        retrieve: vi.fn().mockResolvedValue({
          id: "pi_123",
          status: "succeeded",
          client_secret: null,
          latest_charge: { id: "ch_123", balance_transaction: "txn_123" },
        }),
      },
    });
    const provider = new StripePaymentProvider(client);
    const fee = await provider.getActualProviderFee({ providerPaymentId: "pi_123" });
    expect(fee).toEqual({ feeCents: 74, netCents: 4726, currency: "eur", balanceTransactionId: "txn_123" });
  });
});
