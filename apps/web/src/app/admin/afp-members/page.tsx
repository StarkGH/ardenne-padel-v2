"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Spinner } from "@/components/ui";
import type { AdminAfpMember, AdminAfpadelSyncStatus } from "@/lib/types";

interface MembersResponse {
  data: AdminAfpMember[];
  sync: AdminAfpadelSyncStatus;
}

// Import de l'effectif du club depuis mon.afpadel.be (demande explicite
// 2026-09-14). La synchro elle-même tourne en tâche de fond côté serveur
// (Playwright, une centaine de pages à charger) — cette page ne fait que
// déclencher un cycle et afficher le dernier état connu.
export default function AdminAfpMembersPage() {
  const [members, setMembers] = useState<AdminAfpMember[] | null>(null);
  const [syncStatus, setSyncStatus] = useState<AdminAfpadelSyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);

  const load = useCallback(() => {
    api
      .get<MembersResponse["data"]>("/admin/afp-members")
      .then((data) => setMembers(data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger l'effectif AFPadel."));
    api
      .get<AdminAfpadelSyncStatus>("/admin/afp-members/sync-status")
      .then(setSyncStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!syncStatus?.syncing) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [syncStatus?.syncing, load]);

  async function triggerSync() {
    setTriggering(true);
    setError(null);
    try {
      await api.post("/admin/afp-members/sync", {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de lancer la synchronisation.");
    } finally {
      setTriggering(false);
    }
  }

  if (error) return <ErrorBanner message={error} />;
  if (!members) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">AFP — Ardenne Padel</h1>
          <p className="text-sm text-slate-500">Effectif du club importé depuis mon.afpadel.be.</p>
        </div>
        <Button className="!w-auto" disabled={triggering || syncStatus?.syncing} onClick={triggerSync}>
          {syncStatus?.syncing ? "Synchronisation en cours…" : "Synchroniser"}
        </Button>
      </div>

      {syncStatus?.lastRunAt && (
        <Card>
          <p className="text-sm">
            Dernière synchronisation : <span className="capitalize">{formatDateTime(syncStatus.lastRunAt)}</span>
          </p>
          {syncStatus.lastResult && (
            <p className="mt-1 text-xs text-slate-500">
              {syncStatus.lastResult.membersFound} membre(s) trouvé(s), {syncStatus.lastResult.detailsSynced} fiche(s) détaillée(s) synchronisée(s)
              {syncStatus.lastResult.errors.length > 0 && `, ${syncStatus.lastResult.errors.length} erreur(s)`}.
            </p>
          )}
          {syncStatus.lastResult && syncStatus.lastResult.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-red-600">
              {syncStatus.lastResult.errors.slice(0, 10).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {members.map((m) => (
          <Card key={m.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{m.fullName}</p>
              <p className="text-xs text-slate-500">
                N° {m.afpPlayerId}
                {m.category && ` · ${m.category}`}
                {m.gender && ` · ${m.gender}`}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {m.points !== null && <span className="rounded-md bg-slate-800 px-2 py-1 font-mono text-sm font-semibold text-accent-400">{m.points} pts</span>}
              <span className="text-xs text-slate-500">{m.detailSyncedAt ? `Fiche à jour : ${formatDateTime(m.detailSyncedAt)}` : "Fiche pas encore synchronisée"}</span>
            </div>
          </Card>
        ))}
        {members.length === 0 && <p className="text-sm text-slate-500">Aucun membre importé pour l&apos;instant — lancez une synchronisation.</p>}
      </div>
    </div>
  );
}
