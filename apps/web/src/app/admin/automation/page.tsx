"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, InfoBanner, Spinner, TextInput } from "@/components/ui";
import type { AdminAutomationCommand, AdminAutomationCommandType, AdminAutomationDevice, AdminAutomationZone, AdminStaffAccessCode, Court } from "@/lib/types";

interface ZoneMarginDraft {
  doorBeforeMinutes: string;
  doorAfterMinutes: string;
  lightBeforeMinutes: string;
  lightAfterMinutes: string;
}

function draftFromZone(z: AdminAutomationZone): ZoneMarginDraft {
  return {
    doorBeforeMinutes: z.doorBeforeMinutes?.toString() ?? "",
    doorAfterMinutes: z.doorAfterMinutes?.toString() ?? "",
    lightBeforeMinutes: z.lightBeforeMinutes?.toString() ?? "",
    lightAfterMinutes: z.lightAfterMinutes?.toString() ?? "",
  };
}

const ZONE_TYPE_LABELS: Record<string, string> = { DOOR: "Porte", LIGHT: "Éclairage", GENERIC: "Générique" };

const COMMAND_LABELS: Record<AdminAutomationCommandType, string> = {
  DOOR_OPEN: "Porte — Ouvrir",
  DOOR_CLOSE: "Porte — Fermer",
  LIGHT_ON: "Lumière — Allumer",
  LIGHT_OFF: "Lumière — Éteindre",
};

const COMMAND_RESULT_LABELS: Record<string, string> = {
  PENDING: "Envoi...",
  DELIVERED: "Commande reçue par le Raspberry...",
  SUCCESS: "Commande exécutée.",
  FAILED: "Échec de la commande.",
  EXPIRED: "Aucune confirmation reçue du Raspberry.",
};

const HISTORY_STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  DELIVERED: "Reçue par le Raspberry",
  SUCCESS: "Succès",
  FAILED: "Échec",
  EXPIRED: "Expirée",
};

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 10_000;

function relativeSeconds(iso: string | null, now: number): string {
  if (!iso) return "jamais vu";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `il y a ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return `il y a ${minutes} min`;
}

interface CommandFeedback {
  commandId: string;
  label: string;
  text: string;
  tone: "progress" | "success" | "failed";
}

/**
 * Phase 1 (CDC automatisation) + commandes manuelles
 * (CDC_APV2_COMMANDES_MANUELLES_RASPBERRY_LOGO) : back-office
 * "Accès / Automatisation" — dispositifs Raspberry, zones logiques, et
 * pilotage manuel porte/éclairage. Le backend refuse déjà tout si le device
 * est hors ligne (409 AUTOMATION_DEVICE_OFFLINE) — les boutons désactivés
 * ici sont un confort UX, jamais la seule protection (CDC §11 : "Ne jamais
 * faire confiance uniquement à l'état du bouton côté frontend").
 */
export default function AdminAutomationPage() {
  const [devices, setDevices] = useState<AdminAutomationDevice[] | null>(null);
  const [zones, setZones] = useState<AdminAutomationZone[] | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [savingDevice, setSavingDevice] = useState(false);

  const [showZoneForm, setShowZoneForm] = useState(false);
  const [zoneKey, setZoneKey] = useState("");
  const [zoneLabel, setZoneLabel] = useState("");
  const [zoneType, setZoneType] = useState<"DOOR" | "LIGHT" | "GENERIC">("DOOR");
  const [zoneCourtId, setZoneCourtId] = useState<string>("");
  const [savingZone, setSavingZone] = useState(false);
  const [zoneMarginDrafts, setZoneMarginDrafts] = useState<Record<string, ZoneMarginDraft>>({});
  const [savingZoneMargins, setSavingZoneMargins] = useState<Record<string, boolean>>({});

  const [staffCodes, setStaffCodes] = useState<AdminStaffAccessCode[] | null>(null);
  const [showStaffCodeForm, setShowStaffCodeForm] = useState(false);
  const [staffEmployeeName, setStaffEmployeeName] = useState("");
  const [staffZoneIds, setStaffZoneIds] = useState<string[]>([]);
  const [staffExpiresAt, setStaffExpiresAt] = useState("");
  const [savingStaffCode, setSavingStaffCode] = useState(false);
  const [newStaffCode, setNewStaffCode] = useState<string | null>(null);

  const [pendingByDevice, setPendingByDevice] = useState<Record<string, boolean>>({});
  const [feedbackByDevice, setFeedbackByDevice] = useState<Record<string, CommandFeedback | undefined>>({});
  const [historyByDevice, setHistoryByDevice] = useState<Record<string, AdminAutomationCommand[]>>({});
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  function load() {
    Promise.all([api.get<AdminAutomationDevice[]>("/admin/automation-devices"), api.get<AdminAutomationZone[]>("/admin/automation-zones")])
      .then(([d, z]) => {
        setDevices(d);
        setZones(z);
        for (const device of d) loadHistory(device.id);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger l'automatisation."));
    api
      .get<AdminStaffAccessCode[]>("/admin/staff-access-codes")
      .then(setStaffCodes)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les codes maîtres."));
  }

  function loadHistory(deviceId: string) {
    api
      .get<AdminAutomationCommand[]>(`/admin/automation-devices/${deviceId}/commands?limit=20`)
      .then((commands) => setHistoryByDevice((prev) => ({ ...prev, [deviceId]: commands })))
      .catch(() => {
        /* l'historique est un confort d'affichage, une erreur ici ne doit pas bloquer la page */
      });
  }

  useEffect(load, []);

  useEffect(() => {
    api.get<Court[]>("/courts").then(setCourts).catch(() => {});
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Rafraîchit le statut en ligne/hors ligne sans action de l'utilisateur —
  // le seuil (AUTOMATION_DEVICE_OFFLINE_AFTER_SECONDS, 30 s par défaut) doit
  // se refléter dans l'UI sans qu'un rechargement manuel soit nécessaire.
  useEffect(() => {
    const refresh = setInterval(() => {
      api.get<AdminAutomationDevice[]>("/admin/automation-devices").then(setDevices).catch(() => {});
    }, 5000);
    return () => clearInterval(refresh);
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(pollTimers.current)) clearInterval(timer);
    };
  }, []);

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
      await api.post("/admin/automation-zones", { key: zoneKey, label: zoneLabel, type: zoneType, courtId: zoneCourtId || undefined });
      setZoneKey("");
      setZoneLabel("");
      setZoneCourtId("");
      setShowZoneForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer cette zone.");
    } finally {
      setSavingZone(false);
    }
  }

  function marginDraftFor(zone: AdminAutomationZone): ZoneMarginDraft {
    return zoneMarginDrafts[zone.id] ?? draftFromZone(zone);
  }

  function updateMarginDraft(zoneId: string, zone: AdminAutomationZone, field: keyof ZoneMarginDraft, value: string) {
    setZoneMarginDrafts((prev) => ({ ...prev, [zoneId]: { ...(prev[zoneId] ?? draftFromZone(zone)), [field]: value } }));
  }

  /** Chaîne vide -> null (revient à la marge globale) ; sinon un entier en minutes. */
  function draftValueToPayload(value: string): number | null {
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  async function handleSaveZoneMargins(zone: AdminAutomationZone) {
    const draft = marginDraftFor(zone);
    setSavingZoneMargins((prev) => ({ ...prev, [zone.id]: true }));
    setError(null);
    try {
      await api.patch(`/admin/automation-zones/${zone.id}`, {
        doorBeforeMinutes: draftValueToPayload(draft.doorBeforeMinutes),
        doorAfterMinutes: draftValueToPayload(draft.doorAfterMinutes),
        lightBeforeMinutes: draftValueToPayload(draft.lightBeforeMinutes),
        lightAfterMinutes: draftValueToPayload(draft.lightAfterMinutes),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ces marges.");
    } finally {
      setSavingZoneMargins((prev) => ({ ...prev, [zone.id]: false }));
    }
  }

  function toggleStaffZone(zoneId: string) {
    setStaffZoneIds((prev) => (prev.includes(zoneId) ? prev.filter((id) => id !== zoneId) : [...prev, zoneId]));
  }

  async function handleCreateStaffCode() {
    setSavingStaffCode(true);
    setError(null);
    try {
      const created = await api.post<AdminStaffAccessCode>("/admin/staff-access-codes", {
        employeeName: staffEmployeeName,
        zoneIds: staffZoneIds,
        expiresAt: staffExpiresAt ? new Date(staffExpiresAt).toISOString() : undefined,
      });
      setNewStaffCode(created.code);
      setStaffEmployeeName("");
      setStaffZoneIds([]);
      setStaffExpiresAt("");
      setShowStaffCodeForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer ce code maître.");
    } finally {
      setSavingStaffCode(false);
    }
  }

  async function handleRevokeStaffCode(id: string) {
    try {
      await api.post(`/admin/staff-access-codes/${id}/revoke`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de révoquer ce code.");
    }
  }

  function stopPolling(deviceId: string) {
    const timer = pollTimers.current[deviceId];
    if (timer) {
      clearInterval(timer);
      delete pollTimers.current[deviceId];
    }
  }

  function pollCommand(deviceId: string, commandId: string, label: string) {
    const startedAt = Date.now();
    stopPolling(deviceId);
    pollTimers.current[deviceId] = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        stopPolling(deviceId);
        setFeedbackByDevice((prev) => ({ ...prev, [deviceId]: { commandId, label, text: COMMAND_RESULT_LABELS.EXPIRED!, tone: "failed" } }));
        setPendingByDevice((prev) => ({ ...prev, [deviceId]: false }));
        loadHistory(deviceId);
        return;
      }
      try {
        const command = await api.get<AdminAutomationCommand>(`/admin/automation-commands/${commandId}`);
        const text = COMMAND_RESULT_LABELS[command.status] ?? command.status;
        const failed = command.status === "FAILED" || command.status === "EXPIRED";
        const tone: CommandFeedback["tone"] = command.status === "SUCCESS" ? "success" : failed ? "failed" : "progress";
        setFeedbackByDevice((prev) => ({
          ...prev,
          [deviceId]: { commandId, label, text: failed && command.result ? `${text} (${command.result})` : text, tone },
        }));
        if (command.status === "SUCCESS" || command.status === "FAILED" || command.status === "EXPIRED") {
          stopPolling(deviceId);
          setPendingByDevice((prev) => ({ ...prev, [deviceId]: false }));
          loadHistory(deviceId);
        }
      } catch {
        // Erreur réseau transitoire pendant le polling : on retente au prochain tick, jusqu'au timeout.
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleManualCommand(deviceId: string, type: AdminAutomationCommandType) {
    if (type === "DOOR_OPEN" && !window.confirm("Confirmer l'ouverture de la porte ?")) return;

    setPendingByDevice((prev) => ({ ...prev, [deviceId]: true }));
    setFeedbackByDevice((prev) => ({ ...prev, [deviceId]: { commandId: "", label: COMMAND_LABELS[type], text: "Envoi...", tone: "progress" } }));
    try {
      const command = await api.post<AdminAutomationCommand>(`/admin/automation-devices/${deviceId}/commands`, { type });
      pollCommand(deviceId, command.id, COMMAND_LABELS[type]);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Impossible d'envoyer la commande.";
      setFeedbackByDevice((prev) => ({ ...prev, [deviceId]: { commandId: "", label: COMMAND_LABELS[type], text: message, tone: "failed" } }));
      setPendingByDevice((prev) => ({ ...prev, [deviceId]: false }));
    }
  }

  if (!devices || !zones) return <Spinner />;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-bold">Automatisation</h1>
        <p className="text-sm text-slate-500">
          Contrôle d&apos;accès et éclairage (Raspberry). Commandes manuelles disponibles quand le dispositif est en ligne ; aucune commande n&apos;est jamais mise en
          file pour être exécutée plus tard hors ligne.
        </p>
      </div>
      <ErrorBanner message={error} />
      {newKey && <InfoBanner message={`Clé du dispositif (à noter maintenant, elle ne sera plus jamais affichée) : ${newKey}`} />}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-600">Dispositifs</h2>
        <div className="flex flex-col gap-3">
          {devices.map((d) => {
            const pending = pendingByDevice[d.id] ?? false;
            const feedback = feedbackByDevice[d.id];
            const history = historyByDevice[d.id] ?? [];
            return (
              <Card key={d.id} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{d.name}</p>
                    <p className="text-xs text-slate-400">Dernier heartbeat : {relativeSeconds(d.lastSeenAt, now)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`flex items-center gap-1 text-xs font-medium ${d.offline ? "text-red-600" : "text-emerald-600"}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${d.offline ? "bg-red-600" : "bg-emerald-600"}`} />
                      {d.offline ? "Hors ligne" : "En ligne"}
                    </span>
                    <button onClick={() => handleRevokeDevice(d.id)} className="text-xs text-red-600">
                      Révoquer
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
                  {d.offline && <p className="text-xs text-red-400">Commandes indisponibles : Raspberry hors ligne.</p>}
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-400">Porte</span>
                      <Button variant="secondary" className="!w-auto" disabled={d.offline || pending} onClick={() => handleManualCommand(d.id, "DOOR_OPEN")}>
                        Ouvrir
                      </Button>
                      <Button variant="secondary" className="!w-auto" disabled={d.offline || pending} onClick={() => handleManualCommand(d.id, "DOOR_CLOSE")}>
                        Fermer
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-400">Éclairage</span>
                      <Button variant="secondary" className="!w-auto" disabled={d.offline || pending} onClick={() => handleManualCommand(d.id, "LIGHT_ON")}>
                        Allumer
                      </Button>
                      <Button variant="secondary" className="!w-auto" disabled={d.offline || pending} onClick={() => handleManualCommand(d.id, "LIGHT_OFF")}>
                        Éteindre
                      </Button>
                    </div>
                  </div>
                  {feedback && (
                    <div
                      className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                        feedback.tone === "failed"
                          ? "border-red-500 bg-red-500/10 text-red-300"
                          : feedback.tone === "success"
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                            : "border-amber-500 bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      {feedback.label} — {feedback.text}
                    </div>
                  )}
                </div>

                {history.length > 0 && (
                  <details className="border-t border-slate-800 pt-3">
                    <summary className="cursor-pointer text-xs font-medium text-slate-400">Dernières commandes ({history.length})</summary>
                    <div className="mt-2 flex flex-col gap-1">
                      {history.map((c) => (
                        <div key={c.id} className="flex items-center justify-between text-xs text-slate-400">
                          <span>
                            {formatDateTime(c.createdAt)} · {COMMAND_LABELS[c.type] ?? c.type}
                          </span>
                          <span className={c.status === "FAILED" || c.status === "EXPIRED" ? "text-red-400" : ""}>{HISTORY_STATUS_LABELS[c.status] ?? c.status}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </Card>
            );
          })}
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
          {zones.map((z) => {
            const draft = marginDraftFor(z);
            const saving = savingZoneMargins[z.id] ?? false;
            return (
              <Card key={z.id} className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-medium">{z.label}</p>
                  <p className="text-xs text-slate-500">
                    {z.key} · {ZONE_TYPE_LABELS[z.type] ?? z.type}
                    {z.courtName ? ` · ${z.courtName}` : ""}
                  </p>
                </div>

                {(z.type === "DOOR" || z.type === "LIGHT") && z.courtId && (
                  <div className="flex flex-wrap items-end gap-3 border-t border-slate-800 pt-3">
                    {z.type === "DOOR" && (
                      <>
                        <Field label="Porte : min. avant créneau">
                          <TextInput
                            type="number"
                            min={0}
                            placeholder={`défaut`}
                            value={draft.doorBeforeMinutes}
                            onChange={(e) => updateMarginDraft(z.id, z, "doorBeforeMinutes", e.target.value)}
                            className="!w-24"
                          />
                        </Field>
                        <Field label="Porte : min. après créneau">
                          <TextInput
                            type="number"
                            min={0}
                            placeholder="défaut"
                            value={draft.doorAfterMinutes}
                            onChange={(e) => updateMarginDraft(z.id, z, "doorAfterMinutes", e.target.value)}
                            className="!w-24"
                          />
                        </Field>
                      </>
                    )}
                    {z.type === "LIGHT" && (
                      <>
                        <Field label="Éclairage : min. avant créneau">
                          <TextInput
                            type="number"
                            min={0}
                            placeholder="défaut"
                            value={draft.lightBeforeMinutes}
                            onChange={(e) => updateMarginDraft(z.id, z, "lightBeforeMinutes", e.target.value)}
                            className="!w-24"
                          />
                        </Field>
                        <Field label="Éclairage : min. après créneau">
                          <TextInput
                            type="number"
                            min={0}
                            placeholder="défaut"
                            value={draft.lightAfterMinutes}
                            onChange={(e) => updateMarginDraft(z.id, z, "lightAfterMinutes", e.target.value)}
                            className="!w-24"
                          />
                        </Field>
                      </>
                    )}
                    <Button variant="secondary" className="!w-auto" disabled={saving} onClick={() => handleSaveZoneMargins(z)}>
                      {saving ? "..." : "Enregistrer"}
                    </Button>
                    <p className="w-full text-xs text-slate-500">Laisser vide pour utiliser le réglage global du club.</p>
                  </div>
                )}
              </Card>
            );
          })}
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
            {zoneType !== "GENERIC" && (
              <Field label="Terrain (pour appliquer des marges dédiées à ce terrain)">
                <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={zoneCourtId} onChange={(e) => setZoneCourtId(e.target.value)}>
                  <option value="">— Aucun (zone générale, ex. entrée principale) —</option>
                  {courts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
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

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-600">Codes maîtres employés</h2>
        <p className="text-xs text-slate-500">Nominatifs, zone par zone (jamais universels) — révocables individuellement, expiration optionnelle.</p>
        {newStaffCode && <InfoBanner message={`Code du dispositif (à communiquer à l'employé) : ${newStaffCode}`} />}

        {!staffCodes && <Spinner />}
        {staffCodes && (
          <div className="flex flex-col gap-2">
            {staffCodes.map((c) => (
              <Card key={c.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {c.employeeName} · <span className="font-mono">{c.code}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {c.zones.map((z) => z.label).join(", ")}
                    {c.expiresAt ? ` · expire le ${formatDateTime(c.expiresAt)}` : " · sans expiration"}
                  </p>
                </div>
                <button onClick={() => handleRevokeStaffCode(c.id)} className="text-xs text-red-600">
                  Révoquer
                </button>
              </Card>
            ))}
            {staffCodes.length === 0 && <p className="text-sm text-slate-500">Aucun code maître actif.</p>}
          </div>
        )}

        {!showStaffCodeForm && (
          <Button variant="secondary" onClick={() => setShowStaffCodeForm(true)}>
            Créer un code maître
          </Button>
        )}
        {showStaffCodeForm && (
          <Card className="flex flex-col gap-3">
            <Field label="Nom de l'employé">
              <TextInput value={staffEmployeeName} onChange={(e) => setStaffEmployeeName(e.target.value)} />
            </Field>
            <Field label="Zones autorisées">
              <div className="flex flex-col gap-1">
                {zones.map((z) => (
                  <label key={z.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={staffZoneIds.includes(z.id)} onChange={() => toggleStaffZone(z.id)} />
                    {z.label}
                  </label>
                ))}
                {zones.length === 0 && <p className="text-xs text-slate-500">Aucune zone configurée — créez-en une ci-dessus.</p>}
              </div>
            </Field>
            <Field label="Expiration (optionnelle)">
              <TextInput type="date" value={staffExpiresAt} onChange={(e) => setStaffExpiresAt(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button onClick={handleCreateStaffCode} disabled={savingStaffCode || !staffEmployeeName || staffZoneIds.length === 0}>
                {savingStaffCode ? "..." : "Créer"}
              </Button>
              <Button variant="secondary" onClick={() => setShowStaffCodeForm(false)}>
                Annuler
              </Button>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
