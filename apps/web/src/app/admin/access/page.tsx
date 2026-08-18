"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { api, ApiError } from "@/lib/api";
import { DISPLAY_TIMEZONE, formatDateTime } from "@/lib/datetime";
import { Card, ErrorBanner, Spinner } from "@/components/ui";
import type { AdminAccessGrant } from "@/lib/types";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  ACTIVE: "Actif",
  REVOKED: "Révoqué",
  EXPIRED: "Expiré",
  FAILED: "Échec",
};

// CDC §55 écran 22 — accès. Le code chiffré n'est jamais transmis (CDC §57.1).
export default function AdminAccessPage() {
  const [grants, setGrants] = useState<AdminAccessGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const from = DateTime.now().setZone(DISPLAY_TIMEZONE).minus({ days: 7 }).toUTC().toISO();
    const to = DateTime.now().setZone(DISPLAY_TIMEZONE).plus({ days: 14 }).toUTC().toISO();
    api
      .get<AdminAccessGrant[]>(`/admin/access-grants?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`)
      .then(setGrants)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les accès."));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!grants) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Accès</h1>
      <p className="text-sm text-slate-500">Codes d&apos;accès des réservations des 7 derniers jours et 14 prochains jours.</p>

      <div className="flex flex-col gap-2">
        {grants.map((g) => (
          <Card key={g.id} className="flex items-center justify-between gap-3">
            <div>
              <Link href={`/admin/bookings/${g.bookingId}`} className="text-sm font-medium text-accent-600">
                {g.booking.organizer.firstName} {g.booking.organizer.lastName}
              </Link>
              <p className="text-xs text-slate-500">
                {g.booking.court.name} · <span className="capitalize">{formatDateTime(g.booking.startAt)}</span>
              </p>
              <p className="text-xs text-slate-400">{g.origin === "V2_GENERATED" ? "Généré V2" : "Importé Legacy"}</p>
            </div>
            <span className={`text-xs font-medium ${g.status === "FAILED" ? "text-red-600" : "text-slate-500"}`}>{STATUS_LABELS[g.status] ?? g.status}</span>
          </Card>
        ))}
        {grants.length === 0 && <p className="text-sm text-slate-500">Aucun accès dans cette période.</p>}
      </div>
    </div>
  );
}
