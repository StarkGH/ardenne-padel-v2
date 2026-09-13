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

const ORIGIN_LABELS: Record<string, string> = {
  V2_GENERATED: "Généré V2",
  LEGACY_IMPORTED: "Importé Legacy (Dual Run)",
  LEGACY_ONLY: "Doinsport (non synchronisé V2)",
};

// CDC §55 écran 22 — accès. Le code n'est jamais stocké en clair en base
// (CDC §57.1/§34.4) mais est déchiffré ici pour l'accueil (demande explicite
// du club, 2026-09-12) : le staff doit pouvoir le communiquer/vérifier.
// Inclut aussi les codes des réservations purement Doinsport, synchronisés
// en même temps que les réservations (même demande, 2026-09-12) — ces
// codes-là n'ont pas de réservation V2 correspondante, donc pas de lien.
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
              {g.bookingId ? (
                <Link href={`/admin/bookings/${g.bookingId}`} className="text-sm font-medium text-accent-600">
                  {g.booking.organizer.firstName} {g.booking.organizer.lastName}
                </Link>
              ) : (
                <p className="text-sm font-medium">
                  {g.booking.organizer.firstName} {g.booking.organizer.lastName}
                </p>
              )}
              <p className="text-xs text-slate-500">
                {g.booking.court.name} · <span className="capitalize">{formatDateTime(g.booking.startAt)}</span>
              </p>
              <p className="text-xs text-slate-400">{ORIGIN_LABELS[g.origin] ?? g.origin}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="rounded-md bg-slate-800 px-2 py-1 font-mono text-sm font-semibold text-accent-400">{g.code}</span>
              <span className={`text-xs font-medium ${g.status === "FAILED" ? "text-red-600" : "text-slate-500"}`}>{STATUS_LABELS[g.status] ?? g.status}</span>
            </div>
          </Card>
        ))}
        {grants.length === 0 && <p className="text-sm text-slate-500">Aucun accès dans cette période.</p>}
      </div>
    </div>
  );
}
