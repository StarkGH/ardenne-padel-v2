"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { api, ApiError } from "@/lib/api";
import { DISPLAY_TIMEZONE, formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Spinner } from "@/components/ui";
import type { AdminBooking, LegacySyncRunEntry } from "@/lib/types";

const ISSUE_STATUSES = new Set(["FAILED", "CANCEL_PENDING", "CONFIRMATION_UNKNOWN"]);

const RUN_STATUS_LABELS: Record<LegacySyncRunEntry["status"], string> = {
  RUNNING: "En cours",
  SUCCESS: "Réussi",
  PARTIAL: "Partiel",
  FAILED: "Échec",
};

const RUN_STATUS_COLORS: Record<LegacySyncRunEntry["status"], string> = {
  RUNNING: "text-slate-500",
  SUCCESS: "text-accent-600",
  PARTIAL: "text-amber-700",
  FAILED: "text-red-700",
};

const RUN_KIND_LABELS: Record<LegacySyncRunEntry["kind"], string> = { CLIENTS: "Clients", BOOKINGS: "Réservations" };

// CDC §55 écran 21 — synchronisation Doinsport. Pas d'endpoint dédié : on
// réutilise le planning admin (GET /admin/bookings) et on filtre les
// réservations dont le mapping Legacy est en anomalie (ADR-0025).
export default function AdminSyncPage() {
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [syncRuns, setSyncRuns] = useState<LegacySyncRunEntry[] | null>(null);
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

  function loadSyncRuns() {
    api
      .get<LegacySyncRunEntry[]>("/admin/legacy-sync-runs")
      .then(setSyncRuns)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger l'historique des imports."));
  }

  useEffect(load, []);
  useEffect(loadSyncRuns, []);

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
              <Link href={`/admin/bookings/${b.id}`} className="text-sm font-medium text-accent-600">
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

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Imports récents</h2>
        <p className="text-sm text-slate-500">Historique des exécutions du script d&apos;import Doinsport (clients et réservations).</p>
        {syncRuns === null ? (
          <Spinner />
        ) : syncRuns.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun import exécuté pour le moment.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {syncRuns.map((run) => (
              <Card key={run.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {RUN_KIND_LABELS[run.kind]} — <span className={RUN_STATUS_COLORS[run.status]}>{RUN_STATUS_LABELS[run.status]}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(run.startedAt)}
                    {run.finishedAt ? ` → ${formatDateTime(run.finishedAt)}` : " (en cours)"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {run.itemsChanged} / {run.itemsSeen} élément(s) modifié(s)
                  </p>
                  {run.errorSummary && <p className="text-xs text-red-600">{run.errorSummary}</p>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
