import { loadStripe, type Stripe } from "@stripe/stripe-js";

let stripePromise: Promise<Stripe | null> | null = null;

/**
 * Chargé une seule fois (recommandation Stripe.js officielle — recharger à
 * chaque rendu casse la mise en cache interne du SDK). `null` si la clé
 * publiable n'est pas configurée : les écrans de paiement restent
 * fonctionnels et dégradent proprement (même logique que `STRIPE_NOT_CONFIGURED`
 * côté backend, ADR-0010).
 */
export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}
