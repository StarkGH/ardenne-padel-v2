import { AppError } from "@ardenne/shared";
import type { PaymentProvider } from "./types.js";

/**
 * Utilisée tant qu'aucune clé Stripe n'est configurée (`STRIPE_SECRET_KEY`
 * absent) — permet à l'application de démarrer et à tous les autres modules
 * de fonctionner normalement ; seuls les appels de paiement échouent, avec
 * un message explicite plutôt qu'un crash au démarrage ou une erreur Stripe
 * SDK peu claire.
 */
export class UnconfiguredPaymentProvider implements PaymentProvider {
  private fail(): never {
    throw new AppError(
      "STRIPE_NOT_CONFIGURED",
      "Le paiement en ligne n'est pas encore configuré pour ce club.",
      503,
    );
  }

  async createCustomer(): Promise<never> {
    this.fail();
  }
  async createSetup(): Promise<never> {
    this.fail();
  }
  async createPayment(): Promise<never> {
    this.fail();
  }
  async confirmOrCapture(): Promise<never> {
    this.fail();
  }
  async voidAuthorization(): Promise<never> {
    this.fail();
  }
  async refund(): Promise<never> {
    this.fail();
  }
  async chargeSavedMethod(): Promise<never> {
    this.fail();
  }
  async getActualProviderFee(): Promise<never> {
    this.fail();
  }
}
