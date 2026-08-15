"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { combineDateAndTimeToIso, formatDayLabel, nextNDays } from "@/lib/datetime";
import { Button, Card, ErrorBanner, PriceTag, Spinner, TextInput } from "@/components/ui";
import type { AvailabilitySlot, Court, CourtType, PaymentMode, PricingQuote } from "@/lib/types";

const DRAFT_KEY = "adp:booking-draft";

interface ParticipantDraft {
  displayName: string;
  invitedEmail: string;
}

interface BookingDraft {
  courtId: string;
  dateISO: string;
  startTime: string;
  durationMinutes: number;
  paymentMode: PaymentMode;
  participants: ParticipantDraft[];
}

function loadDraft(): BookingDraft | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(DRAFT_KEY);
  return raw ? (JSON.parse(raw) as BookingDraft) : null;
}

function saveDraft(draft: Partial<BookingDraft>) {
  const current = loadDraft() ?? {};
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...current, ...draft }));
}

function clearDraft() {
  sessionStorage.removeItem(DRAFT_KEY);
}

// CDC §54 écrans 2-4, 6-8, 7 — choix simple/double, calendrier, durée, mode de paiement, participants, récapitulatif.
export default function BookPage() {
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();

  const [courts, setCourts] = useState<Court[]>([]);
  const [courtType, setCourtType] = useState<CourtType | null>(null);
  const [courtId, setCourtId] = useState<string | null>(null);
  const days = useMemo(() => nextNDays(14), []);
  const [dateISO, setDateISO] = useState<string>(days[0]!.toISODate()!);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);
  const [participants, setParticipants] = useState<ParticipantDraft[]>([]);
  const [quote, setQuote] = useState<PricingQuote | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  // Charge les terrains actifs (consultation publique, CDC §10.2).
  useEffect(() => {
    api.get<Court[]>("/courts").then(setCourts).catch(() => setError("Impossible de charger les terrains."));
  }, []);

  // Reprise après retour d'authentification (CDC §53) : restaure la sélection en cours.
  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setCourtId(draft.courtId);
      setDateISO(draft.dateISO);
      setStartTime(draft.startTime);
      setDurationMinutes(draft.durationMinutes);
      setPaymentMode(draft.paymentMode ?? null);
      setParticipants(draft.participants ?? []);
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored || !courtId) return;
    const court = courts.find((c) => c.id === courtId);
    if (court) setCourtType(court.courtType);
  }, [restored, courtId, courts]);

  useEffect(() => {
    if (!courtId || !dateISO) return;
    setLoadingAvailability(true);
    setQuote(null);
    api
      .get<AvailabilitySlot[]>(`/availability?courtId=${courtId}&date=${dateISO}`)
      .then((slots) => {
        setAvailability(slots);
        // Ne réinitialise le créneau que s'il n'est plus valide pour cette
        // liste — sinon la reprise après retour d'authentification (CDC
        // §53) perdrait l'heure déjà choisie à chaque remontage de la page.
        setStartTime((current) => (current && slots.some((s) => s.startTime === current) ? current : null));
      })
      .catch(() => setError("Impossible de charger les disponibilités."))
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
      .catch(() => setError("Impossible de calculer le tarif pour ce créneau."))
      .finally(() => setLoadingQuote(false));
  }, [courtId, dateISO, startTime, durationMinutes]);

  useEffect(() => {
    if (courtId) {
      saveDraft({
        courtId,
        dateISO,
        startTime: startTime ?? undefined,
        durationMinutes: durationMinutes ?? undefined,
        paymentMode: paymentMode ?? undefined,
        participants,
      });
    }
  }, [courtId, dateISO, startTime, durationMinutes, paymentMode, participants]);

  const courtsOfType = courts.filter((c) => c.courtType === courtType);
  const selectedCourt = courts.find((c) => c.id === courtId) ?? null;
  const selectedSlot = availability.find((s) => s.startTime === startTime) ?? null;
  const maxParticipants = (selectedCourt?.capacity ?? 4) - 1;
  const canAddParticipant = participants.length < maxParticipants;
  const splitReady = paymentMode === "FULL" || (paymentMode === "SPLIT" && participants.length >= 1 && participants.every((p) => p.displayName && p.invitedEmail));
  const readyForRecap = Boolean(durationMinutes && paymentMode && splitReady);

  function updateParticipant(index: number, patch: Partial<ParticipantDraft>) {
    setParticipants((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  async function handleConfirm() {
    if (!courtId || !startTime || !durationMinutes || !paymentMode) return;
    if (!user) {
      router.push("/login?next=/book");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const startAtIso = combineDateAndTimeToIso(dateISO, startTime);
      const booking = await api.post<{ id: string }>("/bookings", { courtId, startAt: startAtIso, durationMinutes, paymentMode });

      if (paymentMode === "SPLIT") {
        for (const participant of participants) {
          await api.post(`/bookings/${booking.id}/participants`, {
            displayName: participant.displayName,
            invitedEmail: participant.invitedEmail,
          });
        }
      }

      clearDraft();
      router.push(`/checkout/${booking.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer la réservation.");
      setCreating(false);
    }
  }

  if (!restored || sessionLoading) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Réserver un terrain</h1>
      <ErrorBanner message={error} />

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
              className={`min-h-11 rounded-xl border-2 px-4 py-3 text-base font-medium ${
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
          <h2 className="mb-2 text-sm font-semibold text-slate-500">2. Terrain</h2>
          <div className="flex flex-col gap-2">
            {courtsOfType.map((court) => (
              <button
                key={court.id}
                onClick={() => setCourtId(court.id)}
                className={`min-h-11 rounded-xl border-2 px-4 py-3 text-left text-base font-medium ${
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
          <h2 className="mb-2 text-sm font-semibold text-slate-500">3. Date</h2>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {days.map((day: DateTime) => {
              const iso = day.toISODate()!;
              return (
                <button
                  key={iso}
                  onClick={() => setDateISO(iso)}
                  className={`min-h-11 shrink-0 rounded-xl border-2 px-3 py-2 text-sm font-medium capitalize ${
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
          <h2 className="mb-2 text-sm font-semibold text-slate-500">4. Créneau</h2>
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
                  className={`min-h-11 rounded-xl border-2 px-2 py-2 text-sm font-medium ${
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
          <h2 className="mb-2 text-sm font-semibold text-slate-500">5. Durée</h2>
          <div className="grid grid-cols-3 gap-2">
            {selectedSlot.allowedDurationsMinutes.map((d) => (
              <button
                key={d}
                onClick={() => setDurationMinutes(d)}
                className={`min-h-11 rounded-xl border-2 px-2 py-2 text-sm font-medium ${
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
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">6. Mode de paiement</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setPaymentMode("FULL")}
              className={`min-h-11 rounded-xl border-2 px-3 py-3 text-left text-sm font-medium ${
                paymentMode === "FULL" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white"
              }`}
            >
              Paiement complet
              <span className="mt-0.5 block text-xs font-normal text-slate-500">Vous réglez la totalité</span>
            </button>
            <button
              onClick={() => setPaymentMode("SPLIT")}
              className={`min-h-11 rounded-xl border-2 px-3 py-3 text-left text-sm font-medium ${
                paymentMode === "SPLIT" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white"
              }`}
            >
              Paiement par participant
              <span className="mt-0.5 block text-xs font-normal text-slate-500">Chacun paie sa part</span>
            </button>
          </div>
        </section>
      )}

      {paymentMode === "SPLIT" && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">
            7. Participants <span className="font-normal text-slate-400">({participants.length}/{maxParticipants})</span>
          </h2>
          <div className="flex flex-col gap-3">
            {participants.map((p, i) => (
              <Card key={i} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Participant {i + 1}</span>
                  <button onClick={() => setParticipants((cur) => cur.filter((_, idx) => idx !== i))} className="text-xs text-red-600">
                    Retirer
                  </button>
                </div>
                <TextInput
                  placeholder="Nom"
                  value={p.displayName}
                  onChange={(e) => updateParticipant(i, { displayName: e.target.value })}
                />
                <TextInput
                  placeholder="E-mail"
                  type="email"
                  value={p.invitedEmail}
                  onChange={(e) => updateParticipant(i, { invitedEmail: e.target.value })}
                />
              </Card>
            ))}
            {canAddParticipant && (
              <Button variant="secondary" onClick={() => setParticipants((cur) => [...cur, { displayName: "", invitedEmail: "" }])}>
                + Ajouter un participant
              </Button>
            )}
            {participants.length === 0 && (
              <p className="text-xs text-slate-500">Ajoutez au moins un participant pour activer le paiement partagé.</p>
            )}
          </div>
        </section>
      )}

      {readyForRecap && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-500">Récapitulatif</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-slate-500">Terrain</dt>
            <dd className="text-right font-medium">{selectedCourt?.name}</dd>
            <dt className="text-slate-500">Date</dt>
            <dd className="text-right font-medium capitalize">
              {DateTime.fromISO(dateISO).setLocale("fr").toFormat("EEEE d MMMM")}
            </dd>
            <dt className="text-slate-500">Heure</dt>
            <dd className="text-right font-medium">{startTime}</dd>
            <dt className="text-slate-500">Durée</dt>
            <dd className="text-right font-medium">{durationMinutes} min</dd>
            <dt className="text-slate-500">Mode</dt>
            <dd className="text-right font-medium">{paymentMode === "FULL" ? "Paiement complet" : `Partagé (${participants.length + 1} participants)`}</dd>
            <dt className="text-slate-500">Prix total</dt>
            <dd className="text-right font-medium">
              {loadingQuote && "..."}
              {!loadingQuote && quote && <PriceTag cents={quote.priceTotalCents} currency={quote.currency} />}
            </dd>
          </dl>
          <Button onClick={handleConfirm} disabled={creating || loadingQuote || !quote}>
            {creating ? "Création..." : user ? "Continuer vers le paiement" : "Se connecter et continuer"}
          </Button>
        </Card>
      )}
    </div>
  );
}
