"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, InfoBanner, Spinner, TextInput } from "@/components/ui";
import type { AdminKioskDevice } from "@/lib/types";

// CDC §55 écran 19 — kiosques.
export default function AdminKiosksPage() {
  const [devices, setDevices] = useState<AdminKioskDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [qrHandoff, setQrHandoff] = useState(true);
  const [terminal, setTerminal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  function load() {
    api
      .get<AdminKioskDevice[]>("/admin/kiosk-devices")
      .then(setDevices)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les kiosques."));
  }

  useEffect(load, []);

  async function handleRevoke(id: string) {
    try {
      await api.post(`/admin/kiosk-devices/${id}/revoke`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de révoquer ce kiosque.");
    }
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const capabilities = [qrHandoff && "QR_HANDOFF", terminal && "TERMINAL"].filter(Boolean);
      const result = await api.post<{ deviceId: string; deviceKey: string }>("/admin/kiosk-devices", {
        name,
        location: location || undefined,
        capabilities,
      });
      setNewKey(result.deviceKey);
      setName("");
      setLocation("");
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce kiosque.");
    } finally {
      setSaving(false);
    }
  }

  if (!devices) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Kiosques</h1>
      <ErrorBanner message={error} />
      {newKey && (
        <InfoBanner message={`Clé du dispositif (à noter maintenant, elle ne sera plus jamais affichée) : ${newKey}`} />
      )}

      <div className="flex flex-col gap-2">
        {devices.map((d) => (
          <Card key={d.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{d.name}</p>
              <p className="text-xs text-slate-500">
                {d.location ?? "—"} · {d.capabilities.join(", ")}
              </p>
              <p className="text-xs text-slate-400">{d.lastSeenAt ? `Vu ${formatDateTime(d.lastSeenAt)}` : "Jamais vu"}</p>
            </div>
            <button onClick={() => handleRevoke(d.id)} className="text-xs text-red-600">
              Révoquer
            </button>
          </Card>
        ))}
        {devices.length === 0 && <p className="text-sm text-slate-500">Aucun kiosque enregistré.</p>}
      </div>

      {!showForm && <Button variant="secondary" onClick={() => setShowForm(true)}>Enregistrer un kiosque</Button>}

      {showForm && (
        <Card className="flex flex-col gap-3">
          <Field label="Nom">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Emplacement (optionnel)">
            <TextInput value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={qrHandoff} onChange={(e) => setQrHandoff(e.target.checked)} />
              QR handoff
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={terminal} onChange={(e) => setTerminal(e.target.checked)} />
              Terminal
            </label>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={saving || !name || (!qrHandoff && !terminal)}>
              {saving ? "..." : "Enregistrer"}
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
