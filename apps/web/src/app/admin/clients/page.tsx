"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorBanner, TextInput } from "@/components/ui";
import type { ClientSearchResult } from "@/lib/types";

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
            placeholder="Nom, prénom ou e-mail"
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
          {results.map((r) => (
            <Link key={r.id} href={`/admin/clients/${r.id}`}>
              <Card className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {r.firstName} {r.lastName}
                  </p>
                  <p className="text-xs text-slate-500">{r.email}</p>
                </div>
                <span className="text-xs text-slate-400">{r.role}</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
