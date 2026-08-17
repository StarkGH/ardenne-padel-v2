"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, Spinner, TextInput } from "@/components/ui";
import type { ClientMigrationStatus, ClientSearchResult, LegacyClientMigrationEntry } from "@/lib/types";

const STATUS_LABELS: Record<ClientMigrationStatus, string> = {
  LEGACY_ONLY: "Non traité",
  INVITED: "Invité",
  MIGRATION_PENDING: "Migration en cours",
  MIGRATED: "Migré",
  DISABLED: "Rejeté",
  MERGE_REQUIRED: "Conflit à valider",
};

const STATUS_OPTIONS: ClientMigrationStatus[] = ["MERGE_REQUIRED", "LEGACY_ONLY", "MIGRATED", "DISABLED", "INVITED", "MIGRATION_PENDING"];

// CDC §7.4-§7.5 — revue admin des fiches Shadow Client en conflit de déduplication à l'import Doinsport.
export default function AdminLegacyClientsPage() {
  const [status, setStatus] = useState<ClientMigrationStatus>("MERGE_REQUIRED");
  const [entries, setEntries] = useState<LegacyClientMigrationEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setEntries(null);
    api
      .get<LegacyClientMigrationEntry[]>(`/admin/legacy-clients?status=${status}`)
      .then(setEntries)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les clients Legacy."));
  }

  useEffect(load, [status]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Migration clients Doinsport</h1>
      <p className="text-sm text-slate-500">
        Fiches Doinsport importées (« Shadow Client ») dont le rapprochement automatique avec un compte V2 n&apos;a pas pu
        être décidé sans intervention. Voir <code>docs/adr/0031-modele-import-doinsport.md</code>.
      </p>

      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt}
            onClick={() => setStatus(opt)}
            className={`min-h-11 rounded-xl border-2 px-3 py-2 text-sm font-medium ${
              status === opt ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white"
            }`}
          >
            {STATUS_LABELS[opt]}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} />
      {!entries && !error && <Spinner />}

      {entries && entries.length === 0 && <p className="text-sm text-slate-500">Aucun client dans cet état.</p>}

      {entries && entries.length > 0 && (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <LegacyClientCard key={entry.id} entry={entry} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function LegacyClientCard({ entry, onChanged }: { entry: LegacyClientMigrationEntry; onChanged: () => void }) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [reason, setReason] = useState("");
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await api.get<ClientSearchResult[]>(`/admin/clients?q=${encodeURIComponent(query)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Recherche impossible.");
    } finally {
      setSearching(false);
    }
  }

  async function handleLink(userId: string) {
    setActing(true);
    setError(null);
    try {
      await api.post(`/admin/legacy-clients/${entry.id}/link`, { userId });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de lier ce client.");
    } finally {
      setActing(false);
    }
  }

  async function handleDisable() {
    setActing(true);
    setError(null);
    try {
      await api.post(`/admin/legacy-clients/${entry.id}/disable`, { reason: reason || undefined });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de rejeter ce client.");
    } finally {
      setActing(false);
    }
  }

  async function handleReset() {
    setActing(true);
    setError(null);
    try {
      await api.post(`/admin/legacy-clients/${entry.id}/reset`, {});
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de remettre ce client en attente.");
    } finally {
      setActing(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {entry.firstName} {entry.lastName}
          </p>
          <p className="text-xs text-slate-500">
            {entry.email ?? "—"} {entry.phone ? `· ${entry.phone}` : ""}
          </p>
          <p className="text-xs text-slate-400">
            Doinsport #{entry.externalId} · synchronisé {formatDateTime(entry.lastSyncedAt)}
          </p>
        </div>
        {entry.linkedUser && (
          <p className="text-right text-xs text-emerald-700">
            Lié à {entry.linkedUser.firstName} {entry.linkedUser.lastName}
            <br />({entry.linkedUser.email})
          </p>
        )}
      </div>

      {entry.mergeNote && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{entry.mergeNote}</p>
      )}

      <ErrorBanner message={error} />

      {(entry.migrationStatus === "MERGE_REQUIRED" || entry.migrationStatus === "LEGACY_ONLY") && (
        <div className="flex flex-wrap gap-2">
          {!picking && !disabling && (
            <>
              <Button variant="secondary" className="w-auto shrink-0" onClick={() => setPicking(true)} disabled={acting}>
                Lier à un compte V2
              </Button>
              <Button variant="danger" className="w-auto shrink-0" onClick={() => setDisabling(true)} disabled={acting}>
                Rejeter
              </Button>
            </>
          )}

          {picking && (
            <div className="flex w-full flex-col gap-2 border-t border-slate-100 pt-2">
              <div className="flex gap-2">
                <TextInput
                  placeholder="Nom, prénom ou e-mail du compte V2"
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
                  {results.length === 0 && <p className="text-xs text-slate-400">Aucun compte trouvé.</p>}
                  {results.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => handleLink(r.id)}
                      disabled={acting}
                      className="min-h-11 rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium hover:border-emerald-600"
                    >
                      {r.firstName} {r.lastName} — {r.email}
                    </button>
                  ))}
                </div>
              )}
              <Button variant="secondary" className="w-auto shrink-0" onClick={() => setPicking(false)} disabled={acting}>
                Annuler
              </Button>
            </div>
          )}

          {disabling && (
            <div className="flex w-full flex-col gap-2 border-t border-slate-100 pt-2">
              <Field label="Motif (optionnel)">
                <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. personnes différentes, confirmé par téléphone" />
              </Field>
              <div className="flex gap-2">
                <Button variant="danger" className="w-auto shrink-0" onClick={handleDisable} disabled={acting}>
                  {acting ? "..." : "Confirmer le rejet"}
                </Button>
                <Button variant="secondary" className="w-auto shrink-0" onClick={() => setDisabling(false)} disabled={acting}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {entry.migrationStatus === "DISABLED" && (
        <Button variant="secondary" className="w-auto shrink-0" onClick={handleReset} disabled={acting}>
          {acting ? "..." : "Remettre en attente"}
        </Button>
      )}
    </Card>
  );
}
