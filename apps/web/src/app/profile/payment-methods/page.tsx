"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { Button, Card, ErrorBanner, InfoBanner, Spinner } from "@/components/ui";
import type { PaymentMethod } from "@/lib/types";

const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
};

// CDC §54 écran 19 — gestion des moyens de paiement.
export default function PaymentMethodsPage() {
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addingCard, setAddingCard] = useState(false);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      router.push("/login?next=/profile/payment-methods");
      return;
    }
    api
      .get<PaymentMethod[]>("/me/payment-methods")
      .then(setMethods)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les moyens de paiement."));
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

  async function handleAddCard() {
    setAddingCard(true);
    setError(null);
    setUnconfigured(false);
    try {
      // CDC §25.1 : POST /payments/setup renvoie un SetupIntent Stripe à
      // confirmer côté client (Stripe.js/Elements) — pas encore câblé faute
      // de compte Stripe (ADR-0010), même limite que le reste du parcours.
      await api.post("/payments/setup");
    } catch (err) {
      if (err instanceof ApiError && err.code === "STRIPE_NOT_CONFIGURED") {
        setUnconfigured(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Impossible de démarrer l'ajout d'une carte.");
      }
    } finally {
      setAddingCard(false);
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

      <Button variant="secondary" onClick={handleAddCard} disabled={addingCard}>
        {addingCard ? "..." : "Ajouter une carte"}
      </Button>
    </div>
  );
}
