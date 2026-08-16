"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, InfoBanner, Spinner } from "@/components/ui";
import type { Court, KioskCheckoutSessionPreview } from "@/lib/types";

/**
 * CDC §54.1 écran 5 (suite, côté téléphone) — reprise après scan du QR
 * kiosque. `GET /kiosk/checkout-sessions/:token` réclame automatiquement la
 * session (crée la réservation) dès qu'un utilisateur authentifié la
 * consulte (ADR-0014, pas d'endpoint `/claim` séparé) : ce composant se
 * contente d'appeler le même GET avant et après connexion.
 */
export default function KioskPayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();
  const [preview, setPreview] = useState<Extract<KioskCheckoutSessionPreview, { claimed: false }> | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;
    api
      .get<KioskCheckoutSessionPreview>(`/kiosk/checkout-sessions/${token}`)
      .then((result) => {
        if (result.claimed) {
          router.replace(`/checkout/${result.booking.id}`);
          return;
        }
        setPreview(result);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 410) {
          setError("Cette session a expiré. Merci de recommencer depuis la tablette du club.");
        } else {
          setError(err instanceof ApiError ? err.message : "Session introuvable.");
        }
      })
      .finally(() => setLoading(false));
  }, [token, user, sessionLoading, router]);

  useEffect(() => {
    api.get<Court[]>("/courts").then(setCourts).catch(() => {});
  }, []);

  if (loading || sessionLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  if (!preview) return <ErrorBanner message="Session introuvable." />;

  const court = courts.find((c) => c.id === preview.courtId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Continuer ma réservation</h1>
      <Card className="flex flex-col gap-2">
        {court && <p className="text-lg font-semibold">{court.name}</p>}
        <p className="text-sm capitalize text-slate-600">{formatDateTime(preview.startAt)}</p>
        <p className="text-sm text-slate-500">{preview.durationMinutes} minutes</p>
      </Card>

      {!user && (
        <>
          <InfoBanner message="Connectez-vous pour finaliser cette réservation." />
          <Button onClick={() => router.push(`/login?next=/kiosk-pay/${token}`)}>Se connecter pour continuer</Button>
        </>
      )}

      {/* Utilisateur connecté mais session non PENDING : le GET aurait déjà réclamé et redirigé sinon (ADR-0014). */}
      {user && preview.status === "CANCELED" && <ErrorBanner message="Cette réservation a été annulée depuis la tablette du club." />}
      {user && preview.status !== "CANCELED" && <ErrorBanner message="Cette session a déjà été utilisée." />}
    </div>
  );
}
