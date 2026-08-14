/**
 * Remplaçant temporaire du module Payments (Lot 4). Permet de dérouler la
 * machine à états jusqu'à `CONFIRMED` dès le Lot 3, **sans jamais capturer
 * un vrai paiement** — CDC §91, gate de sortie Lot 3 : "réservation créée
 * de bout en bout [...] sans paiement réel (paiement simulé/mock)".
 *
 * À supprimer/remplacer intégralement au Lot 4 par `StripePaymentProvider`
 * derrière l'interface `PaymentProvider` (CDC §21.1) — ce fichier ne doit
 * jamais être utilisé au-delà du développement local/tests.
 */
export interface PaymentGateway {
  captureFullPayment(input: { bookingId: string; amountCents: number }): Promise<{ succeeded: boolean }>;
}

export class MockAlwaysSucceedsPaymentGateway implements PaymentGateway {
  async captureFullPayment(): Promise<{ succeeded: boolean }> {
    return { succeeded: true };
  }
}
