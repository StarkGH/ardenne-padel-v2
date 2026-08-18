"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { getStripe } from "@/lib/stripe";
import { StripeCardField } from "@/components/stripe-card-field";
import { Button, Card, ErrorBanner, InfoBanner, PriceTag, Spinner } from "@/components/ui";
import type { InvitationShare } from "@/lib/types";

type FundingSource = "WALLET" | "EXTERNAL";

// CDC §54 écran 20 — paiement via invitation (part d'une réservation partagée).
export default function PayInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Elements stripe={getStripe()}>
      <PayInvitationForm params={params} />
    </Elements>
  );
}

function PayInvitationForm({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const { user, loading: sessionLoading } = useSession();
  const [share, setShare] = useState<InvitationShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [fundingSource, setFundingSource] = useState<FundingSource>("WALLET");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    api
      .get<InvitationShare>(`/booking-shares/${token}`)
      .then(setShare)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Invitation introuvable."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handlePay() {
    if (!user) {
      router.push(`/login?next=/pay/${token}`);
      return;
    }
    setPaying(true);
    setError(null);
    setUnconfigured(false);
    try {
      let paymentMethodId: string | undefined;
      if (fundingSource === "EXTERNAL") {
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
        paymentMethodId = paymentMethod.id;
      }
      await api.post(`/booking-shares/${token}/pay`, { fundingSource, paymentMethodId });
      setPaid(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "STRIPE_NOT_CONFIGURED") {
        setUnconfigured(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Le paiement n'a pas pu être traité.");
      }
    } finally {
      setPaying(false);
    }
  }

  if (loading || sessionLoading) return <Spinner />;
  if (!share) return <ErrorBanner message={error ?? "Invitation introuvable."} />;

  if (paid || share.status === "PAID") {
    return (
      <Card className="flex flex-col gap-3">
        <h1 className="text-xl font-bold">Part réglée !</h1>
        <p className="text-sm text-slate-400">Merci, votre participation a bien été enregistrée.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Payer votre part</h1>
      <Card className="flex flex-col gap-2">
        <p className="text-2xl font-bold">
          <PriceTag cents={share.totalAmountCents} />
        </p>
        {share.serviceFeeAmountCents > 0 && (
          <p className="text-xs text-slate-500">
            dont <PriceTag cents={share.serviceFeeAmountCents} /> de frais de service
          </p>
        )}
      </Card>

      {!user && <InfoBanner message="Connectez-vous pour régler votre part." />}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Moyen de paiement</h2>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setFundingSource("WALLET")}
            className={`min-h-11 rounded-xl border-2 px-4 py-3 text-left text-sm font-medium ${
              fundingSource === "WALLET" ? "border-accent-600 bg-accent-600/15 text-accent-300" : "border-slate-800 bg-slate-900"
            }`}
          >
            Mon solde wallet
          </button>
          <button
            onClick={() => setFundingSource("EXTERNAL")}
            className={`min-h-11 rounded-xl border-2 px-4 py-3 text-left text-sm font-medium ${
              fundingSource === "EXTERNAL" ? "border-accent-600 bg-accent-600/15 text-accent-300" : "border-slate-800 bg-slate-900"
            }`}
          >
            Carte bancaire
          </button>
        </div>
      </section>

      {fundingSource === "EXTERNAL" && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Carte bancaire</h2>
          <StripeCardField />
        </section>
      )}

      {unconfigured && (
        <InfoBanner message="Le paiement en ligne n'est pas encore configuré pour ce club (aucun compte Stripe actif pour l'instant)." />
      )}
      <ErrorBanner message={error} />

      <Button onClick={handlePay} disabled={paying}>
        {paying ? "Traitement..." : user ? "Payer ma part" : "Se connecter et payer"}
      </Button>
    </div>
  );
}
