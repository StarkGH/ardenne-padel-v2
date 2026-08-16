"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, PriceTag, Spinner, TextInput } from "@/components/ui";
import type { ClientFile, Role } from "@/lib/types";

const ROLES: Role[] = ["CUSTOMER", "STAFF", "ADMIN", "SUPER_ADMIN"];

// CDC §55 écran 7 — Fiche client. Ne renvoie jamais de donnée carte sensible (CDC §40) — seulement des références Stripe.
export default function AdminClientFilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { user: currentUser } = useSession();
  const [file, setFile] = useState<ClientFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [savingPilot, setSavingPilot] = useState(false);

  function load() {
    api
      .get<ClientFile>(`/admin/clients/${userId}`)
      .then(setFile)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Client introuvable."));
  }

  useEffect(load, [userId]);

  async function handleAddNote() {
    if (!noteBody.trim()) return;
    setSavingNote(true);
    try {
      await api.post(`/admin/clients/${userId}/notes`, { body: noteBody });
      setNoteBody("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'ajouter la note.");
    } finally {
      setSavingNote(false);
    }
  }

  async function handleRoleChange(role: Role) {
    setSavingRole(true);
    try {
      await api.patch(`/admin/clients/${userId}/role`, { role });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de changer le rôle.");
    } finally {
      setSavingRole(false);
    }
  }

  async function handlePilotToggle(enabled: boolean) {
    setSavingPilot(true);
    try {
      await api.patch(`/admin/clients/${userId}/pilot-cohort`, { enabled });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de modifier la cohorte pilote.");
    } finally {
      setSavingPilot(false);
    }
  }

  if (error && !file) return <ErrorBanner message={error} />;
  if (!file) return <Spinner />;

  const { profile, legacyStatus, bookings, payments, refunds, creditPackPurchases, wallet, notes } = file;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">
        {profile.firstName} {profile.lastName}
      </h1>

      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">E-mail</span>
          <span className="font-medium">{profile.email}</span>
        </div>
        {profile.phone && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Téléphone</span>
            <span className="font-medium">{profile.phone}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Statut</span>
          <span className="font-medium">{profile.status}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Origine</span>
          <span className="font-medium">{legacyStatus.origin === "LEGACY_LINKED" ? "Migré depuis Legacy" : "V2 uniquement"}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Dernière connexion</span>
          <span className="font-medium">{profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : "jamais"}</span>
        </div>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-500">Rôle et cohorte</h2>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Rôle actuel</span>
          <span className="font-medium">{profile.role}</span>
        </div>
        {currentUser?.role === "SUPER_ADMIN" && (
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <button
                key={r}
                onClick={() => handleRoleChange(r)}
                disabled={savingRole || r === profile.role}
                className={`min-h-9 rounded-lg border px-3 py-1 text-xs font-medium disabled:opacity-40 ${
                  r === profile.role ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Cohorte pilote</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">{profile.pilotUser ? "Incluse" : "Non incluse"}</span>
            <Button
              variant="secondary"
              className="w-auto"
              onClick={() => handlePilotToggle(!profile.pilotUser)}
              disabled={savingPilot}
            >
              {savingPilot ? "..." : profile.pilotUser ? "Retirer" : "Inclure"}
            </Button>
          </div>
        </div>
      </Card>

      {wallet && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-500">Wallet</h2>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Solde disponible</span>
            <span className="font-medium">
              <PriceTag cents={wallet.balanceAvailableCents} />
            </span>
          </div>
          {wallet.balanceReservedCents > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Réservé (garanties)</span>
              <span className="font-medium">
                <PriceTag cents={wallet.balanceReservedCents} />
              </span>
            </div>
          )}
          {wallet.activeHolds.length > 0 && (
            <p className="text-xs text-slate-400">{wallet.activeHolds.length} garantie(s) active(s).</p>
          )}
          <Link href={`/admin/clients/${userId}/wallet`}>
            <Button variant="secondary">Gérer le wallet</Button>
          </Link>
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">
          Réservations à venir ({bookings.future.length})
        </h2>
        <div className="flex flex-col gap-2">
          {bookings.future.length === 0 && <p className="text-xs text-slate-400">Aucune.</p>}
          {bookings.future.map((b) => (
            <Link key={b.id} href={`/admin/bookings/${b.id}`}>
              <Card className="flex items-center justify-between gap-3">
                <span className="text-sm capitalize">{formatDateTime(b.startAt)}</span>
                <span className="text-xs text-slate-500">{b.status}</span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Historique ({bookings.past.length})</h2>
        <div className="flex flex-col gap-2">
          {bookings.past.slice(0, 10).map((b) => (
            <Link key={b.id} href={`/admin/bookings/${b.id}`}>
              <Card className="flex items-center justify-between gap-3">
                <span className="text-sm capitalize">{formatDateTime(b.startAt)}</span>
                <span className="text-xs text-slate-500">{b.status}</span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {payments.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Paiements ({payments.length})</h2>
          <div className="flex flex-col gap-2">
            {payments.map((p) => (
              <Card key={p.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    <PriceTag cents={p.amountCents} currency={p.currency} />
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.paymentChannel} · {formatDateTime(p.createdAt)}
                  </p>
                </div>
                <span className="text-xs text-slate-500">{p.status}</span>
              </Card>
            ))}
          </div>
        </section>
      )}

      {refunds.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Remboursements ({refunds.length})</h2>
          <div className="flex flex-col gap-2">
            {refunds.map((r) => (
              <Card key={r.id} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">
                  <PriceTag cents={r.amountCents} />
                </span>
                <span className="text-xs text-slate-500">{r.status}</span>
              </Card>
            ))}
          </div>
        </section>
      )}

      {creditPackPurchases.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Achats de crédits ({creditPackPurchases.length})</h2>
          <div className="flex flex-col gap-2">
            {creditPackPurchases.map((c) => (
              <Card key={c.id} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">
                  <PriceTag cents={c.purchaseAmountCents} />
                </span>
                <span className="text-xs text-slate-500">{c.status}</span>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-500">Notes internes ({notes.length})</h2>
        {notes.map((n) => (
          <Card key={n.id} className="flex flex-col gap-1">
            <p className="text-sm">{n.body}</p>
            <p className="text-xs text-slate-400">{formatDateTime(n.createdAt)}</p>
          </Card>
        ))}
        <TextInput placeholder="Ajouter une note..." value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
        <Button variant="secondary" onClick={handleAddNote} disabled={savingNote}>
          {savingNote ? "..." : "Ajouter la note"}
        </Button>
      </section>

      <ErrorBanner message={error} />
    </div>
  );
}
