"use client";

import { CardElement } from "@stripe/react-stripe-js";
import type { StripeCardElementOptions } from "@stripe/stripe-js";

// Repris de la palette de TextInput (components/ui.tsx) — CardElement est un
// iframe Stripe, son style interne ne peut pas hériter des classes Tailwind.
const CARD_ELEMENT_OPTIONS: StripeCardElementOptions = {
  style: {
    base: {
      fontSize: "16px",
      color: "#0f172a", // slate-900
      fontFamily: "inherit",
      "::placeholder": { color: "#94a3b8" }, // slate-400
    },
    invalid: { color: "#dc2626" }, // red-600
  },
};

/** Carte bancaire — CDC §2.6 : aucune donnée carte ne transite jamais par notre backend (iframe Stripe uniquement). */
export function StripeCardField() {
  return (
    <div className="min-h-11 w-full rounded-xl border border-slate-300 px-3 py-3 focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-600">
      <CardElement options={CARD_ELEMENT_OPTIONS} />
    </div>
  );
}
