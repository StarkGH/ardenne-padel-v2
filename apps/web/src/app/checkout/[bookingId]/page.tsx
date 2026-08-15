"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, InfoBanner, PriceTag, Spinner } from "@/components/ui";
import type { Booking, CheckoutResult } from "@/lib/types";

// CDC §54 écrans 8-11 — choix du mode de paiement, moyen de paiement, paiement en ligne, confirmation.
export default function CheckoutPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = use(params);
  const router = useRouter();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

  useEffect(() => {
    api
      .get<Booking>(`/bookings/${bookingId}`)
      .then(setBooking)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Réservation introuvable."))
      .finally(() => setLoading(false));
  }, [bookingId]);

  async function handlePay() {
    setPaying(true);
    setError(null);
    setUnconfigured(false);
    try {
      // CDC §21.1 : le frontend ne collecte/négocie jamais directement le
      // secret Stripe ici sans intégration Stripe Elements (pas encore
      // câblée — aucun compte Stripe pour Ardenne Padel, voir ADR-0010).
      // `paymentMethodId` est un identifiant Stripe obtenu côté client via
      // Stripe.js une fois l'intégration branchée ; en attendant, ce bouton
      // exerce le parcours complet contre l'API réelle et affiche la
      // dégradation attendue (503 `STRIPE_NOT_CONFIGURED`).
      const result = await api.post<CheckoutResult>("/payments/checkout", {
        bookingId,
        paymentMethodId: "pm_card_visa",
      });
      if (result.bookingStatus === "CONFIRMED") {
        router.push(`/bookings/${bookingId}`);
      } else {
        setBooking((b) => (b ? { ...b, status: result.bookingStatus as Booking["status"] } : b));
      }
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

  if (loading) return <Spinner />;
  if (!booking) return <ErrorBanner message={error ?? "Réservation introuvable."} />;

  if (booking.status !== "CHECKOUT_PENDING") {
    return (
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Cette réservation n&apos;est plus en attente de paiement.</p>
        <Button onClick={() => router.push(`/bookings/${bookingId}`)}>Voir la réservation</Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Paiement</h1>
      <Card className="flex flex-col gap-2">
        <p className="text-sm capitalize text-slate-600">{formatDateTime(booking.startAt)}</p>
        <p className="text-2xl font-bold">
          <PriceTag cents={booking.priceTotalCents} currency={booking.currency} />
        </p>
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Moyen de paiement</h2>
        <Card className="flex items-center gap-3">
          <input type="radio" checked readOnly className="h-5 w-5 accent-emerald-600" />
          <span className="text-base font-medium">Carte bancaire</span>
        </Card>
      </section>

      {unconfigured && (
        <InfoBanner message="Le paiement en ligne n'est pas encore configuré pour ce club (aucun compte Stripe actif pour l'instant). Cette page reste fonctionnelle et se connectera automatiquement dès qu'une clé Stripe sera configurée." />
      )}
      <ErrorBanner message={error} />

      <Button onClick={handlePay} disabled={paying}>
        {paying ? "Traitement..." : <>Payer <PriceTag cents={booking.priceTotalCents} currency={booking.currency} /></>}
      </Button>
    </div>
  );
}
