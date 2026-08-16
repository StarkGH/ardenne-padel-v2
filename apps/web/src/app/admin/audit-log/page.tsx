"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, Spinner, TextInput } from "@/components/ui";
import type { AuditLogEntry } from "@/lib/types";

// CDC §55 écran 24 — audit log, lecture seule (append-only, jamais modifiable).
export default function AdminAuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");

  function load() {
    const params = new URLSearchParams();
    if (targetType) params.set("targetType", targetType);
    if (targetId) params.set("targetId", targetId);
    api
      .get<AuditLogEntry[]>(`/admin/audit-log${params.toString() ? `?${params}` : ""}`)
      .then(setEntries)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le journal."));
  }

  useEffect(load, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Journal d&apos;audit</h1>
      <ErrorBanner message={error} />

      <div className="flex gap-2">
        <Field label="Type de cible">
          <TextInput placeholder="ex. Booking" value={targetType} onChange={(e) => setTargetType(e.target.value)} />
        </Field>
        <Field label="Id de cible">
          <TextInput value={targetId} onChange={(e) => setTargetId(e.target.value)} />
        </Field>
      </div>
      <Button variant="secondary" onClick={load}>
        Filtrer
      </Button>

      {!entries && <Spinner />}
      <div className="flex flex-col gap-2">
        {entries?.map((e) => (
          <Card key={e.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{e.action}</span>
              <span className="text-xs text-slate-400">{formatDateTime(e.createdAt)}</span>
            </div>
            <p className="text-xs text-slate-500">
              {e.targetType ? `${e.targetType} · ${e.targetId}` : "—"}
            </p>
            {e.reason && <p className="text-xs text-slate-400">Motif : {e.reason}</p>}
          </Card>
        ))}
        {entries?.length === 0 && <p className="text-sm text-slate-500">Aucune entrée.</p>}
      </div>
    </div>
  );
}
