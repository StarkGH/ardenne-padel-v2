"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorBanner, Field, PriceTag, Spinner, TextInput } from "@/components/ui";
import type { Court, CourtType, TariffRule } from "@/lib/types";

const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

// CDC §55 écran 8 — tarifs. Pas de modification en place côté API : on crée puis on désactive (jamais d'update).
export default function AdminTariffsPage() {
  const [rules, setRules] = useState<TariffRule[] | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [courtId, setCourtId] = useState("");
  const [courtType, setCourtType] = useState<CourtType | "">("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("22:00");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [priceTotalCents, setPriceTotalCents] = useState("2400");
  const [referenceCapacity, setReferenceCapacity] = useState("4");
  const [priority, setPriority] = useState("10");
  const [saving, setSaving] = useState(false);

  function load() {
    api
      .get<TariffRule[]>("/admin/tariff-rules")
      .then(setRules)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les tarifs."));
  }

  useEffect(() => {
    load();
    api.get<Court[]>("/courts").then(setCourts).catch(() => {});
  }, []);

  async function handleDeactivate(id: string) {
    try {
      await api.post(`/admin/tariff-rules/${id}/deactivate`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de désactiver ce tarif.");
    }
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/admin/tariff-rules", {
        name,
        courtId: courtId || undefined,
        courtType: courtType || undefined,
        validFrom: new Date().toISOString(),
        daysOfWeek: days,
        startTime,
        endTime,
        durationMinutes: Number(durationMinutes),
        priceTotalCents: Number(priceTotalCents),
        referenceCapacity: Number(referenceCapacity),
        priority: Number(priority),
      });
      setShowForm(false);
      setName("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer ce tarif.");
    } finally {
      setSaving(false);
    }
  }

  if (!rules) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Tarifs</h1>
      <ErrorBanner message={error} />

      <div className="flex flex-col gap-2">
        {rules.map((r) => (
          <Card key={r.id} className={`flex items-center justify-between gap-3 ${!r.active ? "opacity-50" : ""}`}>
            <div>
              <p className="text-sm font-medium">{r.name}</p>
              <p className="text-xs text-slate-500">
                {r.daysOfWeek.map((d) => DAY_LABELS[d]).join(" ")} · {r.startTime}-{r.endTime} · {r.durationMinutes} min
              </p>
              {r.priceTotalCents !== null && (
                <p className="text-xs text-slate-500">
                  <PriceTag cents={r.priceTotalCents} /> · priorité {r.priority}
                </p>
              )}
            </div>
            {r.active && (
              <button onClick={() => handleDeactivate(r.id)} className="text-xs text-red-600">
                Désactiver
              </button>
            )}
          </Card>
        ))}
        {rules.length === 0 && <p className="text-sm text-slate-500">Aucun tarif configuré.</p>}
      </div>

      {!showForm && <Button variant="secondary" onClick={() => setShowForm(true)}>Ajouter un tarif</Button>}

      {showForm && (
        <Card className="flex flex-col gap-3">
          <Field label="Nom">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Terrain (vide = tous)">
            <select value={courtId} onChange={(e) => setCourtId(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2">
              <option value="">Tous les terrains</option>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type de terrain (vide = tous)">
            <select value={courtType} onChange={(e) => setCourtType(e.target.value as CourtType | "")} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2">
              <option value="">Tous</option>
              <option value="SIMPLE">Simple</option>
              <option value="DOUBLE">Double</option>
            </select>
          </Field>
          <Field label="Jours">
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => setDays((cur) => (cur.includes(i) ? cur.filter((d) => d !== i) : [...cur, i]))}
                  className={`min-h-9 rounded-lg border px-2 py-1 text-xs ${days.includes(i) ? "border-emerald-600 bg-emerald-50" : "border-slate-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Heure début">
              <TextInput value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="Heure fin">
              <TextInput value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Durée (min)">
              <TextInput type="number" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
            </Field>
            <Field label="Prix total (centimes)">
              <TextInput type="number" value={priceTotalCents} onChange={(e) => setPriceTotalCents(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Capacité de référence">
              <TextInput type="number" value={referenceCapacity} onChange={(e) => setReferenceCapacity(e.target.value)} />
            </Field>
            <Field label="Priorité">
              <TextInput type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={saving || !name}>
              {saving ? "..." : "Créer"}
            </Button>
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              Annuler
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
