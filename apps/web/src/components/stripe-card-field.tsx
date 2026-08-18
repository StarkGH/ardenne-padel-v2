"use client";

import { CardElement } from "@stripe/react-stripe-js";
import type { StripeCardElementOptions } from "@stripe/stripe-js";

// Repris de la palette de TextInput (components/ui.tsx) — CardElement est un
// iframe Stripe, son style interne ne peut pas hériter des classes Tailwind.
// Thème sombre : texte clair, pas de texte foncé sur fond foncé.
const CARD_ELEMENT_OPTIONS: StripeCardElementOptions = {
  style: {
    base: {
      fontSize: "16px",
      color: "#f8fafc", // slate-50
      fontFamily: "inherit",
      "::placeholder": { color: "#64748b" }, // slate-500
    },
    invalid: { color: "#f87171" }, // red-400
  },
};

/** Carte bancaire — CDC §2.6 : aucune donnée carte ne transite jamais par notre backend (iframe Stripe uniquement). */
export function StripeCardField() {
  return (
    <div className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 focus-within:border-accent-600 focus-within:ring-1 focus-within:ring-accent-600">
      <CardElement options={CARD_ELEMENT_OPTIONS} />
    </div>
  );
}
