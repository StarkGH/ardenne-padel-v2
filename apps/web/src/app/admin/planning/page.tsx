"use client";

import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { DISPLAY_TIMEZONE } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Spinner } from "@/components/ui";
import type { AdminBooking, Court } from "@/lib/types";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  CHECKOUT_PENDING: "En attente de paiement",
  LEGACY_HOLD_PENDING: "Retenue Legacy",
  PAYMENT_PENDING: "Paiement en cours",
  CONFIRMED: "Confirmée",
  CANCEL_PENDING: "Annulation en cours",
  COMPLETED: "Terminée",
  FAILED: "Échec",
  MANUAL_REVIEW: "Révision manuelle",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "border-slate-300 bg-slate-100 text-slate-700",
  CHECKOUT_PENDING: "border-amber-300 bg-amber-50 text-amber-800",
  LEGACY_HOLD_PENDING: "border-amber-300 bg-amber-50 text-amber-800",
  PAYMENT_PENDING: "border-amber-300 bg-amber-50 text-amber-800",
  CONFIRMED: "border-emerald-300 bg-emerald-50 text-emerald-800",
  CANCEL_PENDING: "border-orange-300 bg-orange-50 text-orange-800",
  COMPLETED: "border-slate-300 bg-slate-100 text-slate-600",
  FAILED: "border-red-300 bg-red-50 text-red-800",
  MANUAL_REVIEW: "border-red-300 bg-red-50 text-red-800",
};

const SLOT_MINUTES = 30;
const DEFAULT_START_MIN = 7 * 60;
const DEFAULT_END_MIN = 23 * 60;

function minutesOfDay(iso: string): number {
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(DISPLAY_TIMEZONE);
  return dt.hour * 60 + dt.minute;
}

function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// CDC §55 écran 3 — Planning multi-terrains. Grille horaire, une colonne par
// terrain (voir ADR-0030) : fenêtre 07h-23h par défaut, étendue si une
// réservation réelle déborde. Créneaux libres cliquables vers la création
// admin, pré-remplie (terrain/date/heure) — pas de vérification de
// disponibilité par cellule (coûteux, N appels), la sélection manuelle de
// créneau côté formulaire reste le filet de sécurité si le créneau cliqué
// n'est en fait plus libre.
export default function AdminPlanningPage() {
  const router = useRouter();
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

  const activeBookings = useMemo(() => (bookings ?? []).filter((b) => b.status !== "CANCELED"), [bookings]);

  const { startMin, endMin, slotCount } = useMemo(() => {
    let start = DEFAULT_START_MIN;
    let end = DEFAULT_END_MIN;
    for (const b of activeBookings) {
      start = Math.min(start, Math.floor(minutesOfDay(b.startAt) / 60) * 60);
      end = Math.max(end, Math.ceil(minutesOfDay(b.endAt) / 60) * 60);
    }
    return { startMin: start, endMin: end, slotCount: (end - start) / SLOT_MINUTES };
  }, [activeBookings]);

  function goToNewBooking(courtId: string, slotStartMin: number) {
    const params = new URLSearchParams({ courtId, date: dateISO, time: minutesToLabel(slotStartMin) });
    router.push(`/admin/bookings/new?${params.toString()}`);
  }

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

      {bookings && courts.length > 0 && (
        <div className="overflow-x-auto">
          <div
            className="grid gap-px bg-slate-200 text-xs"
            style={{
              gridTemplateColumns: `56px repeat(${courts.length}, minmax(140px, 1fr))`,
              gridTemplateRows: `36px repeat(${slotCount}, 28px)`,
            }}
          >
            <div className="sticky left-0 z-10 bg-white" style={{ gridColumn: 1, gridRow: 1 }} />
            {courts.map((court, courtIdx) => (
              <div
                key={court.id}
                className="flex items-center justify-center bg-white px-2 text-center text-sm font-semibold text-slate-700"
                style={{ gridColumn: courtIdx + 2, gridRow: 1 }}
              >
                {court.name}
              </div>
            ))}

            {Array.from({ length: slotCount }, (_, slot) => {
              const slotStartMin = startMin + slot * SLOT_MINUTES;
              const showLabel = slotStartMin % 60 === 0;
              return (
                <div
                  key={`label-${slot}`}
                  className="sticky left-0 z-10 flex items-start justify-end bg-white pr-1 pt-0.5 text-[10px] text-slate-400"
                  style={{ gridColumn: 1, gridRow: slot + 2 }}
                >
                  {showLabel ? minutesToLabel(slotStartMin) : ""}
                </div>
              );
            })}

            {courts.map((court, courtIdx) => {
              const courtBookings = activeBookings.filter((b) => b.courtId === court.id);
              const occupied = new Set<number>();
              const blocks = courtBookings.map((b) => {
                const bStart = Math.max(minutesOfDay(b.startAt), startMin);
                const bEnd = Math.min(minutesOfDay(b.endAt), endMin);
                const startSlot = Math.floor((bStart - startMin) / SLOT_MINUTES);
                const endSlot = Math.ceil((bEnd - startMin) / SLOT_MINUTES);
                for (let s = startSlot; s < endSlot; s++) occupied.add(s);
                return { booking: b, startSlot, endSlot };
              });

              return (
                <div key={court.id} style={{ display: "contents" }}>
                  {blocks.map(({ booking, startSlot, endSlot }) => (
                    <Link
                      key={booking.id}
                      href={`/admin/bookings/${booking.id}`}
                      className={`overflow-hidden rounded border px-1.5 py-0.5 text-[11px] leading-tight ${STATUS_COLORS[booking.status] ?? "border-slate-300 bg-white"}`}
                      style={{ gridColumn: courtIdx + 2, gridRow: `${startSlot + 2} / ${endSlot + 2}` }}
                    >
                      <p className="truncate font-medium">
                        {booking.organizer ? `${booking.organizer.firstName} ${booking.organizer.lastName}` : "Client inconnu"}
                      </p>
                      <p className="truncate text-slate-500">{STATUS_LABELS[booking.status] ?? booking.status}</p>
                    </Link>
                  ))}
                  {Array.from({ length: slotCount }, (_, slot) =>
                    occupied.has(slot) ? null : (
                      <button
                        key={`empty-${slot}`}
                        onClick={() => goToNewBooking(court.id, startMin + slot * SLOT_MINUTES)}
                        className="bg-white hover:bg-emerald-50"
                        style={{ gridColumn: courtIdx + 2, gridRow: slot + 2 }}
                        title={`Créer une réservation à ${minutesToLabel(startMin + slot * SLOT_MINUTES)}`}
                      />
                    ),
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bookings && courts.length === 0 && <p className="text-sm text-slate-500">Aucun terrain configuré.</p>}
    </div>
  );
}
