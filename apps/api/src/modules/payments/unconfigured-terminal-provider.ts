import { AppError } from "@ardenne/shared";
import type { TerminalProvider } from "./terminal-provider.js";

/** Symétrique de `UnconfiguredPaymentProvider` — tant qu'aucune clé Stripe n'est configurée. */
export class UnconfiguredTerminalProvider implements TerminalProvider {
  private fail(): never {
    throw new AppError("STRIPE_NOT_CONFIGURED", "Le paiement par Terminal n'est pas encore configuré pour ce club.", 503);
  }

  async createConnectionToken(): Promise<never> {
    this.fail();
  }
  async createPaymentIntent(): Promise<never> {
    this.fail();
  }
  async capturePaymentIntent(): Promise<never> {
    this.fail();
  }
  async cancelPaymentIntent(): Promise<never> {
    this.fail();
  }
}
