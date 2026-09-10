"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, InfoBanner, Spinner, TextInput } from "@/components/ui";
import type { AdminAutomationDevice, AdminAutomationZone } from "@/lib/types";

const ZONE_TYPE_LABELS: Record<string, string> = { DOOR: "Porte", LIGHT: "Éclairage", GENERIC: "Générique" };

/**
 * Phase 1 (CDC automatisation) : back-office "Accès / Automatisation" —
 * dispositifs Raspberry enregistrés et zones logiques. Aucune commande
 * matérielle n'est déclenchée depuis cet écran au-delà des 4 commandes MVP
 * explicitement listées au CDC.
 */
export default function AdminAutomationPage() {
  const [devices, setDevices] = useState<AdminAutomationDevice[] | null>(null);
  const [zones, setZones] = useState<AdminAutomationZone[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [savingDevice, setSavingDevice] = useState(false);

  const [showZoneForm, setShowZoneForm] = useState(false);
  const [zoneKey, setZoneKey] = useState("");
  const [zoneLabel, setZoneLabel] = useState("");
  const [zoneType, setZoneType] = useState<"DOOR" | "LIGHT" | "GENERIC">("DOOR");
  const [savingZone, setSavingZone] = useState(false);

  function load() {
    Promise.all([api.get<AdminAutomationDevice[]>("/admin/automation-devices"), api.get<AdminAutomationZone[]>("/admin/automation-zones")])
      .then(([d, z]) => {
        setDevices(d);
        setZones(z);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger l'automatisation."));
  }

  useEffect(load, []);

  async function handleRevokeDevice(id: string) {
    try {
      await api.post(`/admin/automation-devices/${id}/revoke`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de révoquer ce dispositif.");
    }
  }

  async function handleCreateDevice() {
    setSavingDevice(true);
    setError(null);
    try {
      const result = await api.post<{ deviceId: string; deviceKey: string }>("/admin/automation-devices", { name: deviceName });
      setNewKey(result.deviceKey);
      setDeviceName("");
      setShowDeviceForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce dispositif.");
    } finally {
      setSavingDevice(false);
    }
  }

  async function handleCreateZone() {
    setSavingZone(true);
    setError(null);
    try {
      await api.post("/admin/automation-zones", { key: zoneKey, label: zoneLabel, type: zoneType });
      setZoneKey("");
      setZoneLabel("");
      setShowZoneForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer cette zone.");
    } finally {
      setSavingZone(false);
    }
  }

  if (!devices || !zones) return <Spinner />;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-bold">Automatisation</h1>
        <p className="text-sm text-slate-500">
          Contrôle d&apos;accès et éclairage (Raspberry). Phase 1 : données uniquement — snapshot, événements, heartbeat. Aucune action physique n&apos;est déclenchée
          par le serveur.
        </p>
      </div>
      <ErrorBanner message={error} />
      {newKey && <InfoBanner message={`Clé du dispositif (à noter maintenant, elle ne sera plus jamais affichée) : ${newKey}`} />}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-600">Dispositifs</h2>
        <div className="flex flex-col gap-2">
          {devices.map((d) => (
            <Card key={d.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{d.name}</p>
                <p className="text-xs text-slate-400">{d.lastSeenAt ? `Vu ${formatDateTime(d.lastSeenAt)}` : "Jamais vu"}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-medium ${d.offline ? "text-red-600" : "text-emerald-600"}`}>{d.offline ? "Hors ligne" : "En ligne"}</span>
                <button onClick={() => handleRevokeDevice(d.id)} className="text-xs text-red-600">
                  Révoquer
                </button>
              </div>
            </Card>
          ))}
          {devices.length === 0 && <p className="text-sm text-slate-500">Aucun dispositif enregistré.</p>}
        </div>

        {!showDeviceForm && (
          <Button variant="secondary" onClick={() => setShowDeviceForm(true)}>
            Enregistrer un dispositif
          </Button>
        )}
        {showDeviceForm && (
          <Card className="flex flex-col gap-3">
            <Field label="Nom (ex. Raspberry entrée principale)">
              <TextInput value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button onClick={handleCreateDevice} disabled={savingDevice || !deviceName}>
                {savingDevice ? "..." : "Enregistrer"}
              </Button>
              <Button variant="secondary" onClick={() => setShowDeviceForm(false)}>
                Annuler
              </Button>
            </div>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-600">Zones</h2>
        <div className="flex flex-col gap-2">
          {zones.map((z) => (
            <Card key={z.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{z.label}</p>
                <p className="text-xs text-slate-500">
                  {z.key} · {ZONE_TYPE_LABELS[z.type] ?? z.type}
                  {z.courtName ? ` · ${z.courtName}` : ""}
                </p>
              </div>
            </Card>
          ))}
          {zones.length === 0 && <p className="text-sm text-slate-500">Aucune zone configurée.</p>}
        </div>

        {!showZoneForm && (
          <Button variant="secondary" onClick={() => setShowZoneForm(true)}>
            Créer une zone
          </Button>
        )}
        {showZoneForm && (
          <Card className="flex flex-col gap-3">
            <Field label="Clé (ex. main_entry, court_3)">
              <TextInput value={zoneKey} onChange={(e) => setZoneKey(e.target.value)} />
            </Field>
            <Field label="Libellé">
              <TextInput value={zoneLabel} onChange={(e) => setZoneLabel(e.target.value)} />
            </Field>
            <Field label="Type">
              <select
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={zoneType}
                onChange={(e) => setZoneType(e.target.value as "DOOR" | "LIGHT" | "GENERIC")}
              >
                <option value="DOOR">Porte</option>
                <option value="LIGHT">Éclairage</option>
                <option value="GENERIC">Générique</option>
              </select>
            </Field>
            <div className="flex gap-2">
              <Button onClick={handleCreateZone} disabled={savingZone || !zoneKey || !zoneLabel}>
                {savingZone ? "..." : "Créer"}
              </Button>
              <Button variant="secondary" onClick={() => setShowZoneForm(false)}>
                Annuler
              </Button>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
