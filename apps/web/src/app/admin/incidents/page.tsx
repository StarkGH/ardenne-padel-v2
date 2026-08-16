"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { api, ApiError } from "@/lib/api";
import { DISPLAY_TIMEZONE, formatDateTime } from "@/lib/datetime";
import { Card, ErrorBanner, PriceTag, Spinner } from "@/components/ui";
import type { AdminBooking } from "@/lib/types";

// CDC §55 écran 23 — incidents / révision manuelle. Pas un concept backend
// distinct : réutilise le planning admin filtré sur `status=MANUAL_REVIEW`
// (ADR-0025) ; actions (annuler, forcer resync) restent sur l'écran détail.
export default function AdminIncidentsPage() {
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const from = DateTime.now().setZone(DISPLAY_TIMEZONE).minus({ days: 30 }).toUTC().toISO();
    const to = DateTime.now().setZone(DISPLAY_TIMEZONE).plus({ days: 14 }).toUTC().toISO();
    api
      .get<AdminBooking[]>(`/admin/bookings?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`)
      .then(setBookings)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les réservations."));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!bookings) return <Spinner />;

  const incidents = bookings.filter((b) => b.status === "MANUAL_REVIEW");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Incidents / révision manuelle</h1>
      <p className="text-sm text-slate-500">Réservations en révision manuelle sur les 30 derniers jours et 14 prochains jours.</p>

      <div className="flex flex-col gap-2">
        {incidents.map((b) => (
          <Link key={b.id} href={`/admin/bookings/${b.id}`}>
            <Card className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{b.organizer ? `${b.organizer.firstName} ${b.organizer.lastName}` : "—"}</p>
                <p className="text-xs capitalize text-slate-500">{formatDateTime(b.startAt)}</p>
              </div>
              <span className="text-sm font-medium">
                <PriceTag cents={b.priceTotalCents} currency={b.currency} />
              </span>
            </Card>
          </Link>
        ))}
        {incidents.length === 0 && <p className="text-sm text-slate-500">Aucun incident en révision manuelle.</p>}
      </div>
    </div>
  );
}
