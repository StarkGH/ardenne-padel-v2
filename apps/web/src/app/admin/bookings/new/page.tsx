"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DateTime } from "luxon";
import { api, ApiError } from "@/lib/api";
import { combineDateAndTimeToIso, DISPLAY_TIMEZONE, formatDayLabel } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, PriceTag, Spinner, TextInput } from "@/components/ui";
import type { AdminBooking, AvailabilitySlot, ClientSearchResult, Court, CourtType, PricingQuote } from "@/lib/types";

// CDC §55 écran 5 — Création réservation (téléphone/guichet) pour un client existant.
// Accessible aussi depuis un créneau vide du planning (?courtId=&date=&time=), qui
// pré-remplit terrain/date/heure une fois le client choisi — voir ADR-0030.
function AdminNewBookingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillCourtId = searchParams.get("courtId");
  const prefillTime = searchParams.get("time");
  const prefillApplied = useRef(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [client, setClient] = useState<ClientSearchResult | null>(null);

  const [courts, setCourts] = useState<Court[]>([]);
  const [courtType, setCourtType] = useState<CourtType | null>(null);
  const [courtId, setCourtId] = useState<string | null>(null);
  const days = useMemo(() => {
    const today = DateTime.now().setZone(DISPLAY_TIMEZONE).startOf("day");
    return Array.from({ length: 14 }, (_, i) => today.plus({ days: i }));
  }, []);
  const [dateISO, setDateISO] = useState(() => searchParams.get("date") ?? DateTime.now().setZone(DISPLAY_TIMEZONE).toISODate()!);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [quote, setQuote] = useState<PricingQuote | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string } | null>(null);

  useEffect(() => {
    api.get<Court[]>("/courts").then(setCourts).catch(() => {});
  }, []);

  // Applique le pré-remplissage venu du planning une fois le client choisi et
  // les terrains chargés — une seule fois (pas à chaque changement manuel ensuite).
  useEffect(() => {
    if (!client || prefillApplied.current || !prefillCourtId || courts.length === 0) return;
    const court = courts.find((c) => c.id === prefillCourtId);
    if (court) {
      setCourtType(court.courtType);
      setCourtId(court.id);
    }
    prefillApplied.current = true;
  }, [client, courts, prefillCourtId]);

  useEffect(() => {
    if (!courtId) return;
    setLoadingAvailability(true);
    setStartTime(null);
    setDurationMinutes(null);
    api
      .get<AvailabilitySlot[]>(`/availability?courtId=${courtId}&date=${dateISO}`)
      .then((slots) => {
        setAvailability(slots);
        if (prefillTime && slots.some((s) => s.startTime === prefillTime)) {
          setStartTime(prefillTime);
        }
      })
      .catch(() => setAvailability([]))
      .finally(() => setLoadingAvailability(false));
  }, [courtId, dateISO, prefillTime]);

  useEffect(() => {
    if (!courtId || !startTime || !durationMinutes) {
      setQuote(null);
      return;
    }
    const startAtIso = combineDateAndTimeToIso(dateISO, startTime);
    api
      .get<PricingQuote>(`/pricing/quote?courtId=${courtId}&startAt=${encodeURIComponent(startAtIso)}&durationMinutes=${durationMinutes}`)
      .then(setQuote)
      .catch(() => setQuote(null));
  }, [courtId, dateISO, startTime, durationMinutes]);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const data = await api.get<ClientSearchResult[]>(`/admin/clients?q=${encodeURIComponent(query)}`);
      setResults(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Recherche impossible.");
    } finally {
      setSearching(false);
    }
  }

  async function handleCreate() {
    if (!client || !courtId || !startTime || !durationMinutes) return;
    setCreating(true);
    setError(null);
    try {
      const startAtIso = combineDateAndTimeToIso(dateISO, startTime);
      const booking = await api.post<{ id: string }>("/admin/bookings", {
        organizerUserId: client.id,
        courtId,
        startAt: startAtIso,
        durationMinutes,
      });
      setCreated(booking);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer la réservation.");
    } finally {
      setCreating(false);
    }
  }

  const courtsOfType = courts.filter((c) => c.courtType === courtType);
  const selectedCourt = courts.find((c) => c.id === courtId) ?? null;
  const selectedSlot = availability.find((s) => s.startTime === startTime) ?? null;

  if (created) {
    return <ParticipantsStep bookingId={created.id} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Nouvelle réservation</h1>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">1. Client</h2>
        {client ? (
          <Card className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {client.firstName} {client.lastName} ({client.email})
            </span>
            <button onClick={() => setClient(null)} className="text-xs text-red-600">
              Changer
            </button>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <TextInput
                placeholder="Nom, prénom ou e-mail"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button className="w-auto shrink-0" onClick={handleSearch} disabled={searching}>
                {searching ? "..." : "Chercher"}
              </Button>
            </div>
            {results && (
              <div className="flex flex-col gap-2">
                {results.length === 0 && <p className="text-xs text-slate-400">Aucun client trouvé.</p>}
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setClient(r)}
                    className="min-h-11 rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium hover:border-emerald-600"
                  >
                    {r.firstName} {r.lastName} — {r.email}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {client && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">2. Type de terrain</h2>
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
      )}

      {courtType && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Terrain</h2>
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
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Date</h2>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {days.map((day) => {
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
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Créneau</h2>
          {loadingAvailability && <Spinner />}
          {!loadingAvailability && availability.length === 0 && <p className="text-sm text-slate-500">Aucune disponibilité.</p>}
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
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Durée</h2>
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

      {durationMinutes && quote && (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Prix total</span>
            <span className="text-xl font-bold">
              <PriceTag cents={quote.priceTotalCents} currency={quote.currency} />
            </span>
          </div>
          <ErrorBanner message={error} />
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Création..." : "Créer la réservation"}
          </Button>
        </Card>
      )}
    </div>
  );
}

export default function AdminNewBookingPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <AdminNewBookingForm />
    </Suspense>
  );
}

// CDC §55 écran 5 — ajout des autres joueurs juste après création, tant que la
// réservation reste modifiable (DRAFT/CHECKOUT_PENDING), avant de passer au
// suivi de paiement.
function ParticipantsStep({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [booking, setBooking] = useState<AdminBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [participantError, setParticipantError] = useState<string | null>(null);

  function reload() {
    api
      .get<AdminBooking>(`/admin/bookings/${bookingId}`)
      .then(setBooking)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Réservation introuvable."))
      .finally(() => setLoading(false));
  }

  useEffect(reload, [bookingId]);

  if (loading) return <Spinner />;
  if (loadError || !booking) return <ErrorBanner message={loadError} />;

  const activeParticipants = (booking.participants ?? []).filter((p) => p.status !== "REMOVED");
  const maxParticipants = (booking.court?.capacity ?? 4) - 1;
  const canAddParticipant = activeParticipants.length < maxParticipants;

  async function handleAdd() {
    if (!newName.trim() || !newEmail.trim()) return;
    setSaving(true);
    setParticipantError(null);
    try {
      await api.post(`/admin/bookings/${bookingId}/participants`, { displayName: newName, invitedEmail: newEmail });
      setNewName("");
      setNewEmail("");
      reload();
    } catch (err) {
      setParticipantError(err instanceof ApiError ? err.message : "Impossible d'ajouter ce joueur.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(participantId: string) {
    setParticipantError(null);
    try {
      await api.delete(`/admin/bookings/${bookingId}/participants/${participantId}`);
      reload();
    } catch (err) {
      setParticipantError(err instanceof ApiError ? err.message : "Impossible de retirer ce joueur.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <h1 className="text-xl font-bold">Réservation créée</h1>
        <p className="text-sm text-slate-600">
          La réservation est en attente de paiement (CHECKOUT_PENDING) — le client peut la régler en ligne, ou un règlement peut
          être suivi manuellement.
        </p>
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">
          Joueurs <span className="font-normal text-slate-400">({activeParticipants.length}/{maxParticipants})</span>
        </h2>
        <div className="flex flex-col gap-3">
          {activeParticipants.map((p) => (
            <Card key={p.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{p.displayName}</p>
                {p.invitedEmail && <p className="text-xs text-slate-500">{p.invitedEmail}</p>}
              </div>
              <button onClick={() => handleRemove(p.id)} className="text-xs text-red-600">
                Retirer
              </button>
            </Card>
          ))}
          {activeParticipants.length === 0 && <p className="text-xs text-slate-500">Aucun autre joueur pour l&apos;instant.</p>}
          {canAddParticipant && (
            <Card className="flex flex-col gap-2">
              <TextInput placeholder="Nom" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <TextInput placeholder="E-mail" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              <Button variant="secondary" onClick={handleAdd} disabled={saving || !newName.trim() || !newEmail.trim()}>
                {saving ? "..." : "+ Ajouter un joueur"}
              </Button>
            </Card>
          )}
          <ErrorBanner message={participantError} />
        </div>
      </section>

      <Button onClick={() => router.push(`/admin/bookings/${bookingId}`)}>Voir la réservation</Button>
    </div>
  );
}
