"use client";

import { use, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, PriceTag, Spinner, TextInput } from "@/components/ui";
import type { AdminBooking } from "@/lib/types";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  CHECKOUT_PENDING: "En attente de paiement",
  LEGACY_HOLD_PENDING: "Retenue Legacy",
  PAYMENT_PENDING: "Paiement en cours",
  CONFIRMED: "Confirmée",
  CANCEL_PENDING: "Annulation en cours",
  CANCELED: "Annulée",
  COMPLETED: "Terminée",
  FAILED: "Échec",
  MANUAL_REVIEW: "Révision manuelle",
};

// CDC §55 écran 4 — Détail réservation (admin, aucun garde-fou organisateur/délai).
export default function AdminBookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [booking, setBooking] = useState<AdminBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [acting, setActing] = useState(false);

  function load() {
    api
      .get<AdminBooking>(`/admin/bookings/${id}`)
      .then(setBooking)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Réservation introuvable."));
  }

  useEffect(load, [id]);

  async function handleCancel() {
    if (!reason.trim()) {
      setError("Un motif est requis pour annuler.");
      return;
    }
    setActing(true);
    setError(null);
    try {
      await api.post(`/admin/bookings/${id}/cancel`, { reason });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'annuler cette réservation.");
    } finally {
      setActing(false);
    }
  }

  async function handleForceResync() {
    setActing(true);
    setError(null);
    try {
      await api.post(`/admin/bookings/${id}/force-resync`, { reason: reason || undefined });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de forcer la resynchronisation.");
    } finally {
      setActing(false);
    }
  }

  if (error && !booking) return <ErrorBanner message={error} />;
  if (!booking) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Réservation</h1>

      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Statut</span>
          <span className="font-medium">{STATUS_LABELS[booking.status] ?? booking.status}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Client</span>
          <span className="font-medium">
            {booking.organizer ? `${booking.organizer.firstName} ${booking.organizer.lastName} (${booking.organizer.email})` : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Créneau</span>
          <span className="font-medium capitalize">{formatDateTime(booking.startAt)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Durée</span>
          <span className="font-medium">{booking.durationMinutes} min</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Prix</span>
          <span className="font-medium">
            <PriceTag cents={booking.priceTotalCents} currency={booking.currency} />
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Mode</span>
          <span className="font-medium">{booking.paymentMode}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Source</span>
          <span className="font-medium">{booking.source}</span>
        </div>
        {booking.legacyBookingMapping && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Synchro Legacy</span>
            <span className="font-medium">{booking.legacyBookingMapping.syncStatus}</span>
          </div>
        )}
      </Card>

      {booking.status === "CONFIRMED" && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-500">Actions</h2>
          <Field label="Motif (requis pour annuler)">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorBanner message={error} />
          <Button variant="danger" onClick={handleCancel} disabled={acting}>
            {acting ? "..." : "Annuler la réservation"}
          </Button>
          {booking.legacyBookingMapping && (
            <Button variant="secondary" onClick={handleForceResync} disabled={acting}>
              {acting ? "..." : "Forcer la resynchronisation Legacy"}
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
