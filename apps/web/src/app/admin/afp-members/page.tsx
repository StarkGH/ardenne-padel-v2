"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, API_BASE_URL } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Spinner } from "@/components/ui";
import type { AdminAfpMember, AdminAfpadelSyncStatus } from "@/lib/types";

interface Column {
  key: string;
  label: string;
  value: (m: AdminAfpMember) => string;
  numeric?: boolean;
  /** Filtre "de / à" (min/max) plutôt qu'un simple texte contenu — colonnes numériques ou date. */
  range?: boolean;
}

const COLUMNS: Column[] = [
  { key: "afpPlayerId", label: "N°", value: (m) => String(m.afpPlayerId), numeric: true, range: true },
  { key: "fullName", label: "Nom", value: (m) => m.fullName },
  { key: "category", label: "Catégorie", value: (m) => m.category ?? "" },
  { key: "gender", label: "Sexe", value: (m) => m.gender ?? "" },
  { key: "points", label: "Points", value: (m) => (m.points !== null ? String(m.points) : ""), numeric: true, range: true },
  { key: "clubName", label: "Club", value: (m) => m.clubName ?? "" },
  { key: "town", label: "Ville", value: (m) => m.town ?? "" },
  { key: "zip", label: "Code postal", value: (m) => m.zip ?? "" },
  { key: "phone", label: "Téléphone", value: (m) => m.phone ?? "" },
  { key: "email", label: "Email", value: (m) => m.email ?? "" },
  { key: "birthdate", label: "Naissance", value: (m) => (m.birthdate ? m.birthdate.slice(0, 10) : ""), range: true },
];

type SortDir = "asc" | "desc";
interface RangeFilter {
  min: string;
  max: string;
}
function isRangeFilter(v: string | RangeFilter | undefined): v is RangeFilter {
  return typeof v === "object" && v !== null;
}

// Import de l'effectif du club depuis mon.afpadel.be (demande explicite
// 2026-09-14) — tableau trié/filtré entièrement côté client : l'effectif
// d'un club (une centaine de membres) ne justifie pas une pagination ou un
// filtrage serveur.
export default function AdminAfpMembersPage() {
  const [members, setMembers] = useState<AdminAfpMember[] | null>(null);
  const [syncStatus, setSyncStatus] = useState<AdminAfpadelSyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [filters, setFilters] = useState<Record<string, string | RangeFilter>>({});
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);

  const load = useCallback(() => {
    api
      .get<AdminAfpMember[]>("/admin/afp-members")
      .then(setMembers)
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

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  const visibleMembers = useMemo(() => {
    if (!members) return [];
    let rows = members;
    for (const col of COLUMNS) {
      const filter = filters[col.key];
      if (!filter) continue;
      if (isRangeFilter(filter)) {
        const min = filter.min.trim();
        const max = filter.max.trim();
        if (!min && !max) continue;
        rows = rows.filter((m) => {
          const raw = col.value(m);
          if (!raw) return false;
          // Comparaison numérique pour N°/Points, lexicale (AAAA-MM-JJ, donc équivalente) pour la date.
          if (col.numeric) {
            const current = Number(raw);
            if (min && current < Number(min)) return false;
            if (max && current > Number(max)) return false;
          } else {
            if (min && raw < min) return false;
            if (max && raw > max) return false;
          }
          return true;
        });
        continue;
      }
      const needle = filter.trim().toLowerCase();
      if (!needle) continue;
      rows = rows.filter((m) => col.value(m).toLowerCase().includes(needle));
    }
    if (sort) {
      const col = COLUMNS.find((c) => c.key === sort.key)!;
      rows = [...rows].sort((a, b) => {
        const av = col.value(a);
        const bv = col.value(b);
        const cmp = col.numeric ? Number(av || 0) - Number(bv || 0) : av.localeCompare(bv, "fr");
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [members, filters, sort]);

  if (error) return <ErrorBanner message={error} />;
  if (!members) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">AFP — Ardenne Padel</h1>
          <p className="text-sm text-slate-500">
            Effectif du club importé depuis mon.afpadel.be — {visibleMembers.length} / {members.length} membre(s) affiché(s).
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`${API_BASE_URL}/admin/afp-members/export`}
            className="flex min-h-11 w-auto items-center rounded-full border-2 border-white bg-transparent px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-white/10 active:bg-white/15"
          >
            Exporter (CSV)
          </a>
          <Button className="!w-auto" disabled={triggering || syncStatus?.syncing} onClick={triggerSync}>
            {syncStatus?.syncing ? "Synchronisation en cours…" : "Synchroniser"}
          </Button>
        </div>
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

      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-900">
              {COLUMNS.map((col) => {
                const active = sort?.key === col.key;
                return (
                  <th key={col.key} className="border-b border-slate-800 p-0 text-left">
                    <button
                      onClick={() => toggleSort(col.key)}
                      className="flex w-full items-center gap-1 px-3 py-2 font-semibold text-slate-200 hover:bg-white/5"
                    >
                      {col.label}
                      <span className="text-xs text-accent-400">{active ? (sort!.dir === "asc" ? "▲" : "▼") : ""}</span>
                    </button>
                    <div className="px-2 pb-2">
                      {col.range ? (
                        <div className="flex gap-1">
                          <input
                            value={(filters[col.key] as RangeFilter | undefined)?.min ?? ""}
                            onChange={(e) =>
                              setFilters((f) => ({ ...f, [col.key]: { min: e.target.value, max: (f[col.key] as RangeFilter | undefined)?.max ?? "" } }))
                            }
                            placeholder="De…"
                            className="w-1/2 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-600"
                          />
                          <input
                            value={(filters[col.key] as RangeFilter | undefined)?.max ?? ""}
                            onChange={(e) =>
                              setFilters((f) => ({ ...f, [col.key]: { min: (f[col.key] as RangeFilter | undefined)?.min ?? "", max: e.target.value } }))
                            }
                            placeholder="À…"
                            className="w-1/2 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-600"
                          />
                        </div>
                      ) : (
                        <input
                          value={(filters[col.key] as string | undefined) ?? ""}
                          onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                          placeholder="Filtrer…"
                          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-600"
                        />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleMembers.map((m) => (
              <tr key={m.id} className="border-b border-slate-800/60 hover:bg-white/5">
                {COLUMNS.map((col) => (
                  <td key={col.key} className="px-3 py-2 text-slate-300">
                    {col.value(m) || <span className="text-slate-600">—</span>}
                  </td>
                ))}
              </tr>
            ))}
            {visibleMembers.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-sm text-slate-500">
                  {members.length === 0 ? "Aucun membre importé pour l'instant — lancez une synchronisation." : "Aucun résultat pour ces filtres."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
