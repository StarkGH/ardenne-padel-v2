import { describe, expect, it, vi } from "vitest";
import type { StripeClientPort } from "./stripe-client-port.js";
import { StripeTerminalProvider } from "./stripe-terminal-provider.js";

function fakeClient(overrides: Partial<StripeClientPort["terminal"]> = {}): StripeClientPort {
  return {
    customers: { create: vi.fn() },
    setupIntents: { create: vi.fn() },
    paymentIntents: { create: vi.fn(), capture: vi.fn(), cancel: vi.fn(), retrieve: vi.fn() },
    refunds: { create: vi.fn() },
    balanceTransactions: { retrieve: vi.fn() },
    webhooks: { constructEvent: vi.fn() },
    paymentMethods: { list: vi.fn(), detach: vi.fn() },
    terminal: {
      createConnectionToken: vi.fn().mockResolvedValue({ secret: "pst_test_123" }),
      createPaymentIntent: vi.fn().mockResolvedValue({ id: "pi_term_1", status: "requires_capture", client_secret: null }),
      capturePaymentIntent: vi.fn().mockResolvedValue({ id: "pi_term_1", status: "succeeded", client_secret: null }),
      cancelPaymentIntent: vi.fn().mockResolvedValue({ id: "pi_term_1", status: "canceled", client_secret: null }),
      ...overrides,
    },
  } as StripeClientPort;
}

describe("StripeTerminalProvider (CDC §22.3-§22.4 — jamais un paiement web reclassé card_present)", () => {
  it("creates a connection token", async () => {
    const client = fakeClient();
    const provider = new StripeTerminalProvider(client);
    const result = await provider.createConnectionToken("tml_loc_1");
    expect(result.secret).toBe("pst_test_123");
    expect(client.terminal.createConnectionToken).toHaveBeenCalledWith("tml_loc_1");
  });

  it("creates a card_present PaymentIntent with manual capture (same two-phase discipline as online — CDC §27.1)", async () => {
    const client = fakeClient();
    const provider = new StripeTerminalProvider(client);
    const result = await provider.createPaymentIntent({ amountCents: 4800, currency: "EUR" });
    expect(result.status).toBe("requires_capture");
    expect(client.terminal.createPaymentIntent).toHaveBeenCalledWith({ amount: 4800, currency: "eur", captureMethod: "manual" });
  });

  it("captures a Terminal payment intent", async () => {
    const client = fakeClient();
    const provider = new StripeTerminalProvider(client);
    const result = await provider.capturePaymentIntent("pi_term_1");
    expect(result.status).toBe("succeeded");
  });

  it("cancels a Terminal payment intent", async () => {
    const client = fakeClient();
    const provider = new StripeTerminalProvider(client);
    const result = await provider.cancelPaymentIntent("pi_term_1");
    expect(result.status).toBe("canceled");
    expect(client.terminal.cancelPaymentIntent).toHaveBeenCalledWith("pi_term_1");
  });
});
