"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { getStripe } from "@/lib/stripe";
import { StripeCardField } from "@/components/stripe-card-field";
import { Button, Card, ErrorBanner, InfoBanner, Spinner } from "@/components/ui";
import type { PaymentMethod } from "@/lib/types";

const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
};

// CDC §54 écran 19 — gestion des moyens de paiement.
export default function PaymentMethodsPage() {
  return (
    <Elements stripe={getStripe()}>
      <PaymentMethodsScreen />
    </Elements>
  );
}

function PaymentMethodsScreen() {
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [startingSetup, setStartingSetup] = useState(false);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [confirmingSetup, setConfirmingSetup] = useState(false);

  function reloadMethods() {
    return api.get<PaymentMethod[]>("/me/payment-methods").then(setMethods);
  }

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      router.push("/login?next=/profile/payment-methods");
      return;
    }
    reloadMethods().catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les moyens de paiement."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sessionLoading, router]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await api.delete(`/me/payment-methods/${id}`);
      setMethods((current) => current?.filter((m) => m.id !== id) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de supprimer ce moyen de paiement.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleStartAddCard() {
    setStartingSetup(true);
    setError(null);
    setUnconfigured(false);
    try {
      // CDC §25.1 : le SetupIntent est créé côté serveur, confirmé côté
      // client (Stripe.js) — la carte elle-même ne transite jamais par
      // notre backend (CDC §2.6).
      const { clientSecret } = await api.post<{ setupIntentId: string; clientSecret: string }>("/payments/setup");
      setSetupClientSecret(clientSecret);
    } catch (err) {
      if (err instanceof ApiError && err.code === "STRIPE_NOT_CONFIGURED") {
        setUnconfigured(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Impossible de démarrer l'ajout d'une carte.");
      }
    } finally {
      setStartingSetup(false);
    }
  }

  async function handleConfirmAddCard() {
    if (!stripe || !elements || !setupClientSecret) return;
    setConfirmingSetup(true);
    setError(null);
    try {
      const card = elements.getElement(CardElement);
      if (!card) {
        setError("Formulaire de carte indisponible, réessayez.");
        return;
      }
      const { error: stripeError } = await stripe.confirmCardSetup(setupClientSecret, { payment_method: { card } });
      if (stripeError) {
        setError(stripeError.message ?? "Carte invalide.");
        return;
      }
      setSetupClientSecret(null);
      await reloadMethods();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette carte.");
    } finally {
      setConfirmingSetup(false);
    }
  }

  if (sessionLoading || !methods) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Moyens de paiement</h1>

      <ErrorBanner message={error} />
      {unconfigured && (
        <InfoBanner message="Le paiement en ligne n'est pas encore configuré pour ce club (aucun compte Stripe actif pour l'instant). Cette page reste fonctionnelle et se connectera automatiquement dès qu'une clé Stripe sera configurée." />
      )}

      {methods.length === 0 && <p className="text-sm text-slate-500">Aucun moyen de paiement enregistré.</p>}

      <div className="flex flex-col gap-3">
        {methods.map((m) => (
          <Card key={m.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{BRAND_LABELS[m.brand] ?? m.brand} •••• {m.last4}</p>
              <p className="text-sm text-slate-500">
                Expire {String(m.expMonth).padStart(2, "0")}/{m.expYear}
              </p>
            </div>
            <Button
              variant="danger"
              className="w-auto shrink-0"
              onClick={() => handleDelete(m.id)}
              disabled={deletingId === m.id}
            >
              {deletingId === m.id ? "..." : "Supprimer"}
            </Button>
          </Card>
        ))}
      </div>

      {setupClientSecret ? (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-800 p-3">
          <h2 className="text-sm font-semibold text-slate-500">Carte bancaire</h2>
          <StripeCardField />
          <div className="flex gap-2">
            <Button onClick={handleConfirmAddCard} disabled={confirmingSetup}>
              {confirmingSetup ? "..." : "Enregistrer cette carte"}
            </Button>
            <Button
              variant="secondary"
              className="w-auto shrink-0"
              onClick={() => setSetupClientSecret(null)}
              disabled={confirmingSetup}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={handleStartAddCard} disabled={startingSetup}>
          {startingSetup ? "..." : "Ajouter une carte"}
        </Button>
      )}
    </div>
  );
}
