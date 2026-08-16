"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { combineDateAndTimeToIso } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Spinner } from "@/components/ui";
import { clearKioskDraft, loadKioskDraft } from "../page";

/**
 * CDC §54.1 écran 3 — "Payer ici". Le client vient de s'identifier
 * directement sur la tablette (`/login?next=/kiosk/pay`) : la réservation
 * est créée immédiatement puis le paiement se fait via l'écran de checkout
 * FULL existant (wallet + carte, ADR-0019/0021) — déjà vérifié de bout en
 * bout, y compris un paiement 100 % wallet réellement abouti. La collecte
 * carte-présente via un vrai lecteur Stripe Terminal reste le point
 * délibérément différé d'ADR-0014 (V-014) ; voir ADR-0023.
 */
export default function KioskPayPage() {
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      router.push("/login?next=/kiosk/pay");
      return;
    }
    const draft = loadKioskDraft();
    if (!draft) {
      setError("Sélection introuvable. Merci de recommencer depuis l'accueil kiosque.");
      return;
    }
    setCreating(true);
    const startAtIso = combineDateAndTimeToIso(draft.dateISO, draft.startTime);
    api
      .post<{ id: string }>("/bookings", {
        courtId: draft.courtId,
        startAt: startAtIso,
        durationMinutes: draft.durationMinutes,
        paymentMode: "FULL",
      })
      .then((booking) => {
        clearKioskDraft();
        router.replace(`/checkout/${booking.id}`);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Impossible de créer la réservation.");
        setCreating(false);
      });
  }, [user, sessionLoading, router]);

  if (error) {
    return (
      <Card className="flex flex-col gap-3">
        <ErrorBanner message={error} />
        <Button onClick={() => router.push("/kiosk")}>Retour à l&apos;accueil kiosque</Button>
      </Card>
    );
  }

  if (creating || sessionLoading || !user) return <Spinner />;
  return <Spinner />;
}
