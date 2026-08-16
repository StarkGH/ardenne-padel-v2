"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, Spinner, TextInput } from "@/components/ui";
import type { AdminTerminalDevice } from "@/lib/types";

// CDC §55 écran 20 — terminaux Stripe. L'appairage matériel réel reste le
// point différé d'ADR-0014 (V-014) ; ceci n'est qu'un inventaire administratif.
export default function AdminTerminalsPage() {
  const [devices, setDevices] = useState<AdminTerminalDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [providerDeviceId, setProviderDeviceId] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    api
      .get<AdminTerminalDevice[]>("/admin/terminal-devices")
      .then(setDevices)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les terminaux."));
  }

  useEffect(load, []);

  async function handleRevoke(id: string) {
    try {
      await api.post(`/admin/terminal-devices/${id}/revoke`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de révoquer ce terminal.");
    }
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/admin/terminal-devices", { name, location: location || undefined, providerDeviceId });
      setName("");
      setLocation("");
      setProviderDeviceId("");
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce terminal.");
    } finally {
      setSaving(false);
    }
  }

  if (!devices) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Terminaux Stripe</h1>
      <ErrorBanner message={error} />

      <div className="flex flex-col gap-2">
        {devices.map((d) => (
          <Card key={d.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{d.name}</p>
              <p className="text-xs text-slate-500">
                {d.location ?? "—"} · {d.status} · id provider : {d.providerDeviceId}
              </p>
              <p className="text-xs text-slate-400">{d.lastSeenAt ? `Vu ${formatDateTime(d.lastSeenAt)}` : "Jamais vu"}</p>
            </div>
            {d.status !== "REVOKED" && (
              <button onClick={() => handleRevoke(d.id)} className="text-xs text-red-600">
                Révoquer
              </button>
            )}
          </Card>
        ))}
        {devices.length === 0 && <p className="text-sm text-slate-500">Aucun terminal enregistré.</p>}
      </div>

      {!showForm && <Button variant="secondary" onClick={() => setShowForm(true)}>Enregistrer un terminal</Button>}

      {showForm && (
        <Card className="flex flex-col gap-3">
          <Field label="Nom">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Emplacement (optionnel)">
            <TextInput value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field label="Identifiant Stripe du lecteur">
            <TextInput value={providerDeviceId} onChange={(e) => setProviderDeviceId(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={saving || !name || !providerDeviceId}>
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
