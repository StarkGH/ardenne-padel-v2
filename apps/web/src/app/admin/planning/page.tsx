"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { DISPLAY_TIMEZONE, formatTimeRange } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Spinner } from "@/components/ui";
import type { AdminBooking, Court } from "@/lib/types";

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

// CDC §55 écran 3 — Planning multi-terrains. Vue par jour, une colonne par terrain.
export default function AdminPlanningPage() {
  const [dateISO, setDateISO] = useState(() => DateTime.now().setZone(DISPLAY_TIMEZONE).toISODate()!);
  const [courts, setCourts] = useState<Court[]>([]);
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Court[]>("/courts").then(setCourts).catch(() => {});
  }, []);

  useEffect(() => {
    const from = DateTime.fromISO(dateISO, { zone: DISPLAY_TIMEZONE }).startOf("day").toUTC().toISO();
    const to = DateTime.fromISO(dateISO, { zone: DISPLAY_TIMEZONE }).endOf("day").toUTC().toISO();
    setBookings(null);
    api
      .get<AdminBooking[]>(`/admin/bookings?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`)
      .then(setBookings)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le planning."));
  }, [dateISO]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Planning multi-terrains</h1>
        <Link href="/admin/bookings/new">
          <Button className="w-auto shrink-0" variant="secondary">
            + Nouvelle réservation
          </Button>
        </Link>
      </div>
      <input
        type="date"
        value={dateISO}
        onChange={(e) => setDateISO(e.target.value)}
        className="min-h-11 w-fit rounded-xl border border-slate-300 px-3 py-2 text-base"
      />

      <ErrorBanner message={error} />
      {!bookings && !error && <Spinner />}

      {bookings && (
        <div className="flex flex-col gap-6">
          {courts.map((court) => {
            const courtBookings = bookings
              .filter((b) => b.courtId === court.id)
              .sort((a, b) => a.startAt.localeCompare(b.startAt));
            return (
              <section key={court.id}>
                <h2 className="mb-2 text-sm font-semibold text-slate-500">{court.name}</h2>
                {courtBookings.length === 0 && <p className="text-xs text-slate-400">Aucune réservation.</p>}
                <div className="flex flex-col gap-2">
                  {courtBookings.map((b) => (
                    <Link key={b.id} href={`/admin/bookings/${b.id}`}>
                      <Card className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{formatTimeRange(b.startAt, b.endAt)}</p>
                          <p className="text-xs text-slate-500">
                            {b.organizer ? `${b.organizer.firstName} ${b.organizer.lastName}` : "Client inconnu"}
                          </p>
                        </div>
                        <span className="text-xs font-medium text-slate-500">{STATUS_LABELS[b.status] ?? b.status}</span>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
