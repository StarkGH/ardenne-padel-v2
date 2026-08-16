"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { api, ApiError } from "@/lib/api";
import { DISPLAY_TIMEZONE, formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Spinner } from "@/components/ui";
import type { AdminBooking } from "@/lib/types";

const ISSUE_STATUSES = new Set(["FAILED", "CANCEL_PENDING", "CONFIRMATION_UNKNOWN"]);

// CDC §55 écran 21 — synchronisation Doinsport. Pas d'endpoint dédié : on
// réutilise le planning admin (GET /admin/bookings) et on filtre les
// réservations dont le mapping Legacy est en anomalie (ADR-0025).
export default function AdminSyncPage() {
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  function load() {
    const from = DateTime.now().setZone(DISPLAY_TIMEZONE).minus({ days: 7 }).toUTC().toISO();
    const to = DateTime.now().setZone(DISPLAY_TIMEZONE).plus({ days: 14 }).toUTC().toISO();
    api
      .get<AdminBooking[]>(`/admin/bookings?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`)
      .then(setBookings)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les réservations."));
  }

  useEffect(load, []);

  async function handleForceResync(bookingId: string) {
    setActing(bookingId);
    try {
      await api.post(`/admin/bookings/${bookingId}/force-resync`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de forcer la resynchronisation.");
    } finally {
      setActing(null);
    }
  }

  if (error) return <ErrorBanner message={error} />;
  if (!bookings) return <Spinner />;

  const issues = bookings.filter((b) => b.legacyBookingMapping && ISSUE_STATUSES.has(b.legacyBookingMapping.syncStatus));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Synchronisation Doinsport</h1>
      <p className="text-sm text-slate-500">Réservations des 7 derniers jours et 14 prochains jours dont la synchro Legacy est en anomalie.</p>

      <div className="flex flex-col gap-2">
        {issues.map((b) => (
          <Card key={b.id} className="flex items-center justify-between gap-3">
            <div>
              <Link href={`/admin/bookings/${b.id}`} className="text-sm font-medium text-emerald-700">
                {b.organizer ? `${b.organizer.firstName} ${b.organizer.lastName}` : "—"}
              </Link>
              <p className="text-xs capitalize text-slate-500">{formatDateTime(b.startAt)}</p>
              <p className="text-xs text-red-600">{b.legacyBookingMapping?.syncStatus}{b.legacyBookingMapping?.lastError ? ` — ${b.legacyBookingMapping.lastError}` : ""}</p>
            </div>
            <Button variant="secondary" className="w-auto shrink-0" onClick={() => handleForceResync(b.id)} disabled={acting === b.id}>
              {acting === b.id ? "..." : "Forcer resync"}
            </Button>
          </Card>
        ))}
        {issues.length === 0 && <p className="text-sm text-slate-500">Aucune anomalie de synchronisation détectée.</p>}
      </div>
    </div>
  );
}
