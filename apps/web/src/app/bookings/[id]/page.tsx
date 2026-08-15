"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, PriceTag, Spinner } from "@/components/ui";
import type { Booking } from "@/lib/types";

interface AccessGrant {
  id: string;
  code: string;
  origin: "V2_GENERATED" | "LEGACY_IMPORTED";
  status: string;
  validFrom: string;
  validUntil: string;
}

// CDC §54 écrans 11, 13, 14 — confirmation + code, détail, annulation.
export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [access, setAccess] = useState<AccessGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      api.get<Booking>(`/bookings/${id}`),
      api.get<AccessGrant[]>(`/bookings/${id}/access`).catch(() => []),
    ])
      .then(([b, a]) => {
        setBooking(b);
        setAccess(a);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Réservation introuvable."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleCancel() {
    if (!confirm("Confirmez-vous l'annulation de cette réservation ?")) return;
    setCanceling(true);
    setError(null);
    try {
      await api.post(`/bookings/${id}/cancel`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'annuler cette réservation.");
    } finally {
      setCanceling(false);
    }
  }

  if (loading) return <Spinner />;
  if (!booking) return <ErrorBanner message={error ?? "Réservation introuvable."} />;

  const canCancel = booking.status === "CONFIRMED";

  return (
    <div className="flex flex-col gap-6">
      <button onClick={() => router.push("/bookings")} className="text-sm text-slate-500">
        ← Mes réservations
      </button>

      {booking.status === "CONFIRMED" && (
        <Card className="bg-emerald-700 text-white">
          <p className="font-semibold">Réservation confirmée</p>
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        <p className="text-lg font-semibold capitalize">{formatDateTime(booking.startAt)}</p>
        <p className="text-sm text-slate-600">{booking.durationMinutes} minutes</p>
        <p className="text-xl font-bold">
          <PriceTag cents={booking.priceTotalCents} currency={booking.currency} />
        </p>
      </Card>

      {access.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-500">Code d&apos;accès</h2>
          {access.map((grant) => (
            <p key={grant.id} className="font-mono text-2xl font-bold tracking-wider text-emerald-700">
              {grant.code}
            </p>
          ))}
        </Card>
      )}

      <ErrorBanner message={error} />

      {canCancel && (
        <Button variant="danger" onClick={handleCancel} disabled={canceling}>
          {canceling ? "Annulation..." : "Annuler la réservation"}
        </Button>
      )}
    </div>
  );
}
