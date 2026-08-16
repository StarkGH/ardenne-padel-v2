"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { api } from "@/lib/api";
import { combineDateAndTimeToIso, formatDayLabel } from "@/lib/datetime";
import { Button, Card, PriceTag, Spinner } from "@/components/ui";
import type { AvailabilitySlot, Court, CourtType, PricingQuote } from "@/lib/types";

const KIOSK_DRAFT_KEY = "adp:kiosk-draft";

export interface KioskDraft {
  courtId: string;
  dateISO: string;
  startTime: string;
  durationMinutes: number;
}

export function loadKioskDraft(): KioskDraft | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(KIOSK_DRAFT_KEY);
  return raw ? (JSON.parse(raw) as KioskDraft) : null;
}

export function clearKioskDraft() {
  sessionStorage.removeItem(KIOSK_DRAFT_KEY);
}

function nextNDaysLocal(n: number): DateTime[] {
  const today = DateTime.now().setZone("Europe/Brussels").startOf("day");
  return Array.from({ length: n }, (_, i) => today.plus({ days: i }));
}

/**
 * CDC §54.1 écrans 1-2 — choix réservation (borne/tablette), FULL uniquement
 * (pas de paiement partagé au kiosque). Volontairement une sélection
 * autonome, distincte de `/book` (qui gère aussi SPLIT et les participants,
 * hors périmètre kiosque).
 */
export default function KioskHomePage() {
  const router = useRouter();
  const [courts, setCourts] = useState<Court[]>([]);
  const [courtType, setCourtType] = useState<CourtType | null>(null);
  const [courtId, setCourtId] = useState<string | null>(null);
  const days = useMemo(() => nextNDaysLocal(7), []);
  const [dateISO, setDateISO] = useState<string>(days[0]!.toISODate()!);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [quote, setQuote] = useState<PricingQuote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);

  useEffect(() => {
    api.get<Court[]>("/courts").then(setCourts).catch(() => {});
    clearKioskDraft();
  }, []);

  useEffect(() => {
    if (!courtId) return;
    setLoadingAvailability(true);
    setStartTime(null);
    setDurationMinutes(null);
    api
      .get<AvailabilitySlot[]>(`/availability?courtId=${courtId}&date=${dateISO}`)
      .then(setAvailability)
      .catch(() => setAvailability([]))
      .finally(() => setLoadingAvailability(false));
  }, [courtId, dateISO]);

  useEffect(() => {
    if (!courtId || !startTime || !durationMinutes) {
      setQuote(null);
      return;
    }
    setLoadingQuote(true);
    const startAtIso = combineDateAndTimeToIso(dateISO, startTime);
    api
      .get<PricingQuote>(`/pricing/quote?courtId=${courtId}&startAt=${encodeURIComponent(startAtIso)}&durationMinutes=${durationMinutes}`)
      .then(setQuote)
      .catch(() => setQuote(null))
      .finally(() => setLoadingQuote(false));
  }, [courtId, dateISO, startTime, durationMinutes]);

  const courtsOfType = courts.filter((c) => c.courtType === courtType);
  const selectedCourt = courts.find((c) => c.id === courtId) ?? null;
  const selectedSlot = availability.find((s) => s.startTime === startTime) ?? null;

  function saveDraftAndGo(path: string) {
    if (!courtId || !startTime || !durationMinutes) return;
    sessionStorage.setItem(KIOSK_DRAFT_KEY, JSON.stringify({ courtId, dateISO, startTime, durationMinutes } satisfies KioskDraft));
    router.push(path);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Réserver au club</h1>

      <Link href="/kiosk/credits">
        <Button variant="secondary">Acheter ou recharger des crédits</Button>
      </Link>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">1. Type de terrain</h2>
        <div className="grid grid-cols-2 gap-3">
          {(["SIMPLE", "DOUBLE"] as CourtType[]).map((type) => (
            <button
              key={type}
              onClick={() => {
                setCourtType(type);
                setCourtId(null);
              }}
              className={`min-h-14 rounded-xl border-2 px-4 py-3 text-lg font-medium ${
                courtType === type ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white"
              }`}
            >
              {type === "SIMPLE" ? "Simple" : "Double"}
            </button>
          ))}
        </div>
      </section>

      {courtType && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Terrain</h2>
          <div className="flex flex-col gap-2">
            {courtsOfType.map((court) => (
              <button
                key={court.id}
                onClick={() => setCourtId(court.id)}
                className={`min-h-14 rounded-xl border-2 px-4 py-3 text-left text-lg font-medium ${
                  courtId === court.id ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white"
                }`}
              >
                {court.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {selectedCourt && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Date</h2>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {days.map((day) => {
              const iso = day.toISODate()!;
              return (
                <button
                  key={iso}
                  onClick={() => setDateISO(iso)}
                  className={`min-h-14 shrink-0 rounded-xl border-2 px-3 py-2 text-sm font-medium capitalize ${
                    dateISO === iso ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white"
                  }`}
                >
                  {formatDayLabel(day)}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {selectedCourt && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Créneau</h2>
          {loadingAvailability && <Spinner />}
          {!loadingAvailability && availability.length === 0 && (
            <p className="text-sm text-slate-500">Aucune disponibilité ce jour-là.</p>
          )}
          {!loadingAvailability && availability.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {availability.map((slot) => (
                <button
                  key={slot.startTime}
                  onClick={() => {
                    setStartTime(slot.startTime);
                    setDurationMinutes(null);
                  }}
                  className={`min-h-14 rounded-xl border-2 px-2 py-2 text-sm font-medium ${
                    startTime === slot.startTime ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white"
                  }`}
                >
                  {slot.startTime}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {selectedSlot && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Durée</h2>
          <div className="grid grid-cols-3 gap-2">
            {selectedSlot.allowedDurationsMinutes.map((d) => (
              <button
                key={d}
                onClick={() => setDurationMinutes(d)}
                className={`min-h-14 rounded-xl border-2 px-2 py-2 text-sm font-medium ${
                  durationMinutes === d ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white"
                }`}
              >
                {d} min
              </button>
            ))}
          </div>
        </section>
      )}

      {durationMinutes && (
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Prix total</span>
            <span className="text-xl font-bold">
              {loadingQuote && "..."}
              {!loadingQuote && quote && <PriceTag cents={quote.priceTotalCents} currency={quote.currency} />}
            </span>
          </div>
          <h2 className="text-sm font-semibold text-slate-500">2. Comment souhaitez-vous continuer ?</h2>
          <Button onClick={() => saveDraftAndGo("/login?next=/kiosk/pay")} disabled={!quote}>
            Je m&apos;identifie ici et je paie
          </Button>
          <Button variant="secondary" onClick={() => saveDraftAndGo("/kiosk/qr")} disabled={!quote}>
            Continuer sur mon téléphone
          </Button>
        </Card>
      )}
    </div>
  );
}
