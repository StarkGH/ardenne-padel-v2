"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorBanner, TextInput } from "@/components/ui";
import type { ClientMigrationStatus, ClientSearchResult } from "@/lib/types";

const MIGRATION_STATUS_LABELS: Record<ClientMigrationStatus, string> = {
  LEGACY_ONLY: "Non traité",
  INVITED: "Invité",
  MIGRATION_PENDING: "Migration en cours",
  MIGRATED: "Migré",
  DISABLED: "Rejeté",
  MERGE_REQUIRED: "Conflit à valider",
};

// CDC §55 écran 6 — Clients.
export default function AdminClientsPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Clients</h1>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <TextInput
            placeholder="Nom, prénom, e-mail ou téléphone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
        </div>
        <Button className="!w-auto shrink-0" onClick={handleSearch} disabled={searching}>
          {searching ? "..." : "Chercher"}
        </Button>
      </div>

      <ErrorBanner message={error} />

      {results && (
        <div className="flex flex-col gap-2">
          {results.length === 0 && <p className="text-sm text-slate-500">Aucun client trouvé.</p>}
          {results.map((r) =>
            r.source === "V2" ? (
              <Link key={`v2-${r.id}`} href={`/admin/clients/${r.id}`}>
                <Card className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {r.firstName} {r.lastName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.email}
                      {r.phone ? ` · ${r.phone}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400">{r.role}</span>
                </Card>
              </Link>
            ) : (
              // Client Doinsport pas encore migré (CDC §7.3-§7.5) — pas de
              // compte V2, donc pas de fiche détaillée ; seule la revue de
              // migration (/admin/legacy-clients) permet d'agir dessus.
              <Card key={`legacy-${r.id}`} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {r.firstName} {r.lastName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {r.email ?? "Pas d'e-mail"}
                    {r.phone ? ` · ${r.phone}` : ""}
                  </p>
                </div>
                <span className="rounded-full border border-purple-700 bg-purple-500/15 px-2 py-0.5 text-xs text-purple-300">
                  Doinsport · {MIGRATION_STATUS_LABELS[r.migrationStatus]}
                </span>
              </Card>
            ),
          )}
        </div>
      )}
    </div>
  );
}
