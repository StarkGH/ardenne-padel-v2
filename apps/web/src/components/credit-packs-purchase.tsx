"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { getStripe } from "@/lib/stripe";
import { StripeCardField } from "@/components/stripe-card-field";
import { Button, Card, ErrorBanner, InfoBanner, PriceTag, Spinner } from "@/components/ui";
import type { CreditPack, CreditPackPurchaseResult } from "@/lib/types";

/**
 * Achat d'un pack de crédits (CDC §54 écran 16), factorisé pour être
 * réutilisé tel quel par `/wallet/packs` (client) et `/kiosk/credits`
 * (écran kiosque 8, CDC §54.1) — même parcours d'achat, seule la coquille
 * autour change (route de connexion, destination après achat).
 */
export function CreditPacksPurchase(props: { title: string; loginNext: string; confirmedHref: string; confirmedLabel: string }) {
  return (
    <Elements stripe={getStripe()}>
      <CreditPacksPurchaseForm {...props} />
    </Elements>
  );
}

function CreditPacksPurchaseForm({
  title,
  loginNext,
  confirmedHref,
  confirmedLabel,
}: {
  title: string;
  loginNext: string;
  confirmedHref: string;
  confirmedLabel: string;
}) {
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [purchasedPackId, setPurchasedPackId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<CreditPack[]>("/credit-packs")
      .then((data) => setPacks(data.slice().sort((a, b) => a.displayOrder - b.displayOrder)))
      .catch(() => setError("Impossible de charger les packs de crédits."));
  }, []);

  async function handlePurchase(packId: string) {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(loginNext)}`);
      return;
    }
    setPurchasingId(packId);
    setError(null);
    setUnconfigured(false);
    try {
      if (!stripe || !elements) {
        setUnconfigured(true);
        return;
      }
      const card = elements.getElement(CardElement);
      if (!card) {
        setError("Formulaire de carte indisponible, réessayez.");
        return;
      }
      const { paymentMethod, error: stripeError } = await stripe.createPaymentMethod({ type: "card", card });
      if (stripeError || !paymentMethod) {
        setError(stripeError?.message ?? "Carte invalide.");
        return;
      }
      const result = await api.post<CreditPackPurchaseResult>(`/credit-packs/${packId}/purchase`, { paymentMethodId: paymentMethod.id });
      if (!result.requiresAction) {
        setPurchasedPackId(packId);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "STRIPE_NOT_CONFIGURED") {
        setUnconfigured(true);
      } else {
        setError(err instanceof ApiError ? err.message : "L'achat n'a pas pu être traité.");
      }
    } finally {
      setPurchasingId(null);
    }
  }

  if (sessionLoading || !packs) return <Spinner />;

  if (purchasedPackId) {
    return (
      <Card className="flex flex-col gap-3">
        <h1 className="text-xl font-bold">Achat confirmé !</h1>
        <p className="text-sm text-slate-600">Vos crédits ont été ajoutés à votre wallet.</p>
        <Button onClick={() => router.push(confirmedHref)}>{confirmedLabel}</Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">{title}</h1>

      {unconfigured && (
        <InfoBanner message="Le paiement en ligne n'est pas encore configuré pour ce club (aucun compte Stripe actif pour l'instant). Cette page reste fonctionnelle et se connectera automatiquement dès qu'une clé Stripe sera configurée." />
      )}
      <ErrorBanner message={error} />

      <div className="flex flex-col gap-3">
        {packs.map((pack) => (
          <Card key={pack.id} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{pack.name}</p>
                <p className="text-sm text-slate-600">
                  <PriceTag cents={pack.paidCreditsCents} /> de crédits
                  {pack.bonusCreditsCents > 0 && (
                    <span className="text-emerald-700"> + <PriceTag cents={pack.bonusCreditsCents} /> offerts</span>
                  )}
                </p>
              </div>
              {selectedPackId !== pack.id && (
                <Button className="w-auto shrink-0" variant="secondary" onClick={() => setSelectedPackId(pack.id)}>
                  <PriceTag cents={pack.purchaseAmountCents} />
                </Button>
              )}
            </div>
            {selectedPackId === pack.id && (
              <div className="flex flex-col gap-3 border-t border-slate-100 pt-3">
                <StripeCardField />
                <Button onClick={() => handlePurchase(pack.id)} disabled={purchasingId === pack.id}>
                  {purchasingId === pack.id ? "..." : <>Payer <PriceTag cents={pack.purchaseAmountCents} /></>}
                </Button>
              </div>
            )}
          </Card>
        ))}
        {packs.length === 0 && <p className="text-sm text-slate-500">Aucun pack disponible pour l&apos;instant.</p>}
      </div>
    </div>
  );
}
