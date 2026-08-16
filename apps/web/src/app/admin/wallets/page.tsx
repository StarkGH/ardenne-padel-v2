"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorBanner, TextInput } from "@/components/ui";
import type { ClientSearchResult } from "@/lib/types";

// CDC §55 écran 10 — wallets. Pas de liste globale côté API (le wallet est
// intrinsèquement lié à un client) : on recherche un client, puis on
// atterrit sur la gestion de son wallet (écrans 11/14).
export default function AdminWalletsPage() {
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
      <h1 className="text-xl font-bold">Wallets</h1>
      <p className="text-sm text-slate-500">Recherchez un client pour consulter et gérer son wallet.</p>
      <div className="flex gap-2">
        <TextInput
          placeholder="Nom, prénom ou e-mail"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <Button className="w-auto shrink-0" onClick={handleSearch} disabled={searching}>
          {searching ? "..." : "Chercher"}
        </Button>
      </div>

      <ErrorBanner message={error} />

      {results && (
        <div className="flex flex-col gap-2">
          {results.length === 0 && <p className="text-sm text-slate-500">Aucun client trouvé.</p>}
          {results.map((r) => (
            <Link key={r.id} href={`/admin/clients/${r.id}/wallet`}>
              <Card className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {r.firstName} {r.lastName}
                  </p>
                  <p className="text-xs text-slate-500">{r.email}</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
