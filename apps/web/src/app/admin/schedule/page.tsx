"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, Spinner, TextInput } from "@/components/ui";
import type { ClosureType, Court, CourtClosure, OpeningRule } from "@/lib/types";

const DAY_LABELS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

// CDC §55 écran 9 — horaires d'ouverture et fermetures exceptionnelles.
export default function AdminSchedulePage() {
  const [openingRules, setOpeningRules] = useState<OpeningRule[] | null>(null);
  const [closures, setClosures] = useState<CourtClosure[] | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [courtId, setCourtId] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("22:00");

  const [closureCourtId, setClosureCourtId] = useState("");
  const [closureStart, setClosureStart] = useState("");
  const [closureEnd, setClosureEnd] = useState("");
  const [closureType, setClosureType] = useState<ClosureType>("MAINTENANCE");
  const [closureReason, setClosureReason] = useState("");

  function load() {
    api.get<OpeningRule[]>("/admin/opening-rules").then(setOpeningRules).catch(() => {});
    api.get<CourtClosure[]>("/admin/court-closures").then(setClosures).catch(() => {});
  }

  useEffect(() => {
    load();
    api.get<Court[]>("/courts").then(setCourts).catch(() => {});
  }, []);

  async function handleCreateOpeningRule() {
    setError(null);
    try {
      await api.post("/admin/opening-rules", {
        courtId: courtId || undefined,
        dayOfWeek: Number(dayOfWeek),
        startTime,
        endTime,
        validFrom: new Date().toISOString(),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer cet horaire.");
    }
  }

  async function handleDeactivateOpeningRule(id: string) {
    try {
      await api.post(`/admin/opening-rules/${id}/deactivate`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de désactiver cet horaire.");
    }
  }

  async function handleCreateClosure() {
    if (!closureCourtId || !closureStart || !closureEnd) return;
    setError(null);
    try {
      await api.post("/admin/court-closures", {
        courtId: closureCourtId,
        startAt: new Date(closureStart).toISOString(),
        endAt: new Date(closureEnd).toISOString(),
        reason: closureReason || undefined,
        closureType,
      });
      setClosureStart("");
      setClosureEnd("");
      setClosureReason("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer cette fermeture.");
    }
  }

  async function handleDeleteClosure(id: string) {
    try {
      await api.delete(`/admin/court-closures/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de supprimer cette fermeture.");
    }
  }

  if (!openingRules || !closures) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Horaires et fermetures</h1>
      <ErrorBanner message={error} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-500">Horaires d&apos;ouverture</h2>
        {openingRules.map((r) => (
          <Card key={r.id} className={`flex items-center justify-between gap-3 ${!r.active ? "opacity-50" : ""}`}>
            <span className="text-sm">
              {DAY_LABELS[r.dayOfWeek]} · {r.startTime}-{r.endTime}
            </span>
            {r.active && (
              <button onClick={() => handleDeactivateOpeningRule(r.id)} className="text-xs text-red-600">
                Désactiver
              </button>
            )}
          </Card>
        ))}
        {openingRules.length === 0 && <p className="text-xs text-slate-400">Aucun horaire configuré.</p>}
        <Card className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Terrain (vide = tous)">
              <select value={courtId} onChange={(e) => setCourtId(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-white">
                <option value="">Tous</option>
                {courts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Jour">
              <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-white [color-scheme:dark]">
                {DAY_LABELS.map((label, i) => (
                  <option key={i} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ouverture">
              <TextInput value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="Fermeture">
              <TextInput value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>
          <Button variant="secondary" onClick={handleCreateOpeningRule}>
            Ajouter un horaire
          </Button>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-500">Fermetures exceptionnelles</h2>
        {closures.map((c) => (
          <Card key={c.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{courts.find((court) => court.id === c.courtId)?.name ?? c.courtId}</p>
              <p className="text-xs text-slate-500 capitalize">
                {formatDateTime(c.startAt)} → {formatDateTime(c.endAt)} · {c.closureType}
              </p>
              {c.reason && <p className="text-xs text-slate-400">{c.reason}</p>}
            </div>
            <button onClick={() => handleDeleteClosure(c.id)} className="text-xs text-red-600">
              Supprimer
            </button>
          </Card>
        ))}
        {closures.length === 0 && <p className="text-xs text-slate-400">Aucune fermeture programmée.</p>}
        <Card className="flex flex-col gap-3">
          <Field label="Terrain">
            <select value={closureCourtId} onChange={(e) => setClosureCourtId(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-white [color-scheme:dark]">
              <option value="">Choisir...</option>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Début">
              <input type="datetime-local" value={closureStart} onChange={(e) => setClosureStart(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-white [color-scheme:dark]" />
            </Field>
            <Field label="Fin">
              <input type="datetime-local" value={closureEnd} onChange={(e) => setClosureEnd(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-white [color-scheme:dark]" />
            </Field>
          </div>
          <Field label="Type">
            <select value={closureType} onChange={(e) => setClosureType(e.target.value as ClosureType)} className="min-h-11 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-white [color-scheme:dark]">
              <option value="MAINTENANCE">Maintenance</option>
              <option value="EVENT">Événement</option>
              <option value="ADMIN_BLOCK">Blocage administratif</option>
            </select>
          </Field>
          <Field label="Motif (optionnel)">
            <TextInput value={closureReason} onChange={(e) => setClosureReason(e.target.value)} />
          </Field>
          <Button variant="secondary" onClick={handleCreateClosure} disabled={!closureCourtId || !closureStart || !closureEnd}>
            Ajouter une fermeture
          </Button>
        </Card>
      </section>
    </div>
  );
}
