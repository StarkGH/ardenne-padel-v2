import type { PaymentsRepository } from "./payments.repository.js";
import type { PaymentProvider } from "./types.js";

/** Partagé entre `CheckoutService` et `CreditPackService` — un seul endroit qui sait créer/mémoriser le Stripe Customer d'un utilisateur. */
export async function ensureStripeCustomer(
  paymentsRepo: PaymentsRepository,
  paymentProvider: PaymentProvider,
  userId: string,
): Promise<{ id: string; email: string; customerId: string }> {
  const user = await paymentsRepo.findUserForPayment(userId);
  if (!user) throw new Error(`ensureStripeCustomer: utilisateur ${userId} introuvable`);

  if (user.stripeCustomerId) {
    return { id: user.id, email: user.email, customerId: user.stripeCustomerId };
  }

  const customer = await paymentProvider.createCustomer({ userId: user.id, email: user.email });
  await paymentsRepo.updateUserStripeCustomerId(user.id, customer.customerId);
  return { id: user.id, email: user.email, customerId: customer.customerId };
}
