"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { kioskApi } from "@/lib/kiosk-api";
import { ApiError } from "@/lib/api";
import { combineDateAndTimeToIso } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Spinner } from "@/components/ui";
import { clearKioskDraft, loadKioskDraft } from "../page";
import type { KioskCheckoutSessionCreated, KioskCheckoutSessionStatus } from "@/lib/types";

const WEB_BASE_URL = process.env.NEXT_PUBLIC_WEB_BASE_URL ?? "http://localhost:3001";
const POLL_INTERVAL_MS = 3000;

const TERMINAL_BOOKING_STATUSES = new Set(["CONFIRMED", "CANCELED", "FAILED", "MANUAL_REVIEW"]);

/**
 * CDC §54.1 écrans 4-7 — QR de reprise, état temps réel, confirmation. Le QR
 * ne porte que la référence de session (CDC §22.2 : jamais de donnée
 * bancaire ni de secret durable au-delà du token opaque de session).
 * `KioskCheckoutSession.status` n'atteint jamais `COMPLETED` côté backend
 * (voir ADR-0014) — le statut réel du paiement est déduit de
 * `bookingStatus`, pas de `status`.
 */
export default function KioskQrPage() {
  const router = useRouter();
  const [session, setSession] = useState<KioskCheckoutSessionCreated | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<KioskCheckoutSessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const createdRef = useRef(false);

  useEffect(() => {
    // Garde contre le double-appel des effets en StrictMode (dev) : POST
    // /kiosk/checkout-sessions crée une vraie session côté serveur, jamais
    // idempotent à relancer silencieusement (contrairement aux GET de lecture
    // utilisés ailleurs dans l'app).
    if (createdRef.current) return;
    createdRef.current = true;

    const draft = loadKioskDraft();
    if (!draft) {
      setError("Sélection introuvable. Merci de recommencer depuis l'accueil kiosque.");
      return;
    }
    const startAtIso = combineDateAndTimeToIso(draft.dateISO, draft.startTime);
    kioskApi
      .post<KioskCheckoutSessionCreated>("/kiosk/checkout-sessions", {
        courtId: draft.courtId,
        startAt: startAtIso,
        durationMinutes: draft.durationMinutes,
        paymentMode: "FULL",
      })
      .then(async (created) => {
        setSession(created);
        const url = `${WEB_BASE_URL}/kiosk-pay/${created.token}`;
        setQrDataUrl(await QRCode.toDataURL(url, { width: 320, margin: 1 }));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de créer la session kiosque."));
  }, []);

  useEffect(() => {
    if (!session) return;
    async function poll() {
      try {
        const s = await kioskApi.get<KioskCheckoutSessionStatus>(`/kiosk/checkout-sessions/${session!.id}/status`);
        setStatus(s);
        if (s.bookingStatus && TERMINAL_BOOKING_STATUSES.has(s.bookingStatus)) {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Panne de polling ponctuelle — on retente au prochain tick, pas d'erreur bloquante.
      }
    }
    void poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [session]);

  async function handleCancel() {
    if (!session) return;
    setCanceling(true);
    try {
      await kioskApi.post(`/kiosk/checkout-sessions/${session.id}/cancel`);
    } catch {
      // Annulation best-effort — on retourne à l'accueil dans tous les cas.
    } finally {
      clearKioskDraft();
      router.push("/kiosk");
    }
  }

  if (error) {
    return (
      <Card className="flex flex-col gap-3">
        <ErrorBanner message={error} />
        <Button onClick={() => router.push("/kiosk")}>Retour à l&apos;accueil kiosque</Button>
      </Card>
    );
  }

  if (!session || !qrDataUrl) return <Spinner />;

  if (status?.bookingStatus === "CONFIRMED") {
    return (
      <Card className="flex flex-col items-center gap-4 py-10 text-center">
        <h1 className="text-2xl font-bold text-accent-600">Réservation confirmée !</h1>
        <p className="text-sm text-slate-400">Le paiement a été effectué sur votre téléphone. Bon match !</p>
        <Button
          onClick={() => {
            clearKioskDraft();
            router.push("/kiosk");
          }}
        >
          Nouvelle réservation
        </Button>
      </Card>
    );
  }

  if (status?.bookingStatus && ["CANCELED", "FAILED", "MANUAL_REVIEW"].includes(status.bookingStatus)) {
    return (
      <Card className="flex flex-col items-center gap-4 py-10 text-center">
        <h1 className="text-xl font-bold text-red-700">Paiement non abouti</h1>
        <p className="text-sm text-slate-400">La réservation n&apos;a pas pu être confirmée depuis le téléphone.</p>
        <Button
          onClick={() => {
            clearKioskDraft();
            router.push("/kiosk");
          }}
        >
          Retour à l&apos;accueil kiosque
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col items-center gap-4 py-6 text-center">
      <h1 className="text-xl font-bold">Continuez sur votre téléphone</h1>
      <p className="text-sm text-slate-400">Scannez ce code avec l&apos;appareil photo de votre téléphone.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL générée côté client, pas d'optimisation Next.js pertinente */}
      <img src={qrDataUrl} alt="QR code de reprise sur smartphone" width={240} height={240} />
      <p className="text-sm font-medium text-slate-200">
        {status?.bookingId ? "Réservation créée, en attente de paiement sur votre téléphone..." : "En attente de connexion sur votre téléphone..."}
      </p>
      <Spinner />
      <Button variant="secondary" onClick={handleCancel} disabled={canceling}>
        {canceling ? "..." : "Annuler"}
      </Button>
    </Card>
  );
}
