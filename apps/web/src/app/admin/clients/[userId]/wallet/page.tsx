"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, PriceTag, Spinner, TextInput } from "@/components/ui";
import type { AdminWalletHold, AdminWalletTransaction, ClientFile } from "@/lib/types";

const TX_LABELS: Record<string, string> = {
  CREDIT_PACK_PURCHASE: "Achat de crédits",
  CREDIT_PACK_BONUS: "Crédits bonus",
  CREDIT_ADMIN: "Crédit admin",
  DEBIT_BOOKING: "Réservation réglée",
  REFUND_BOOKING: "Remboursement",
  HOLD_CREATED: "Garantie réservée",
  HOLD_RELEASED: "Garantie libérée",
  HOLD_CAPTURED: "Garantie prélevée",
  ADJUSTMENT: "Ajustement admin",
  BONUS_EXPIRY: "Expiration de bonus",
};

// CDC §55 écrans 10-11-14 — wallet d'un client : solde, crédit/débit avec motif, garanties.
export default function AdminClientWalletPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const [file, setFile] = useState<ClientFile | null>(null);
  const [holds, setHolds] = useState<AdminWalletHold[] | null>(null);
  const [transactions, setTransactions] = useState<AdminWalletTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [debitAmount, setDebitAmount] = useState("");
  const [debitReason, setDebitReason] = useState("");
  const [acting, setActing] = useState(false);

  function load() {
    api
      .get<ClientFile>(`/admin/clients/${userId}`)
      .then((f) => {
        setFile(f);
        if (f.wallet) {
          api.get<AdminWalletHold[]>(`/admin/wallets/${f.wallet.walletAccountId}/holds`).then(setHolds).catch(() => {});
          api.get<AdminWalletTransaction[]>(`/admin/wallets/${f.wallet.walletAccountId}/transactions`).then(setTransactions).catch(() => {});
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Client introuvable."));
  }

  useEffect(load, [userId]);

  async function handleCredit() {
    if (!file?.wallet || !creditAmount || !creditReason) return;
    setActing(true);
    setError(null);
    try {
      await api.post(`/admin/wallets/${file.wallet.walletAccountId}/credit`, { amountCents: Math.round(Number(creditAmount) * 100), reason: creditReason });
      setCreditAmount("");
      setCreditReason("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créditer ce wallet.");
    } finally {
      setActing(false);
    }
  }

  async function handleDebit() {
    if (!file?.wallet || !debitAmount || !debitReason) return;
    setActing(true);
    setError(null);
    try {
      await api.post(`/admin/wallets/${file.wallet.walletAccountId}/debit`, { amountCents: Math.round(Number(debitAmount) * 100), reason: debitReason });
      setDebitAmount("");
      setDebitReason("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de débiter ce wallet.");
    } finally {
      setActing(false);
    }
  }

  async function handleRelease(holdId: string) {
    setActing(true);
    try {
      await api.post(`/admin/wallet-holds/${holdId}/release`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de libérer cette garantie.");
    } finally {
      setActing(false);
    }
  }

  async function handleCapture(holdId: string) {
    setActing(true);
    try {
      await api.post(`/admin/wallet-holds/${holdId}/capture`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de prélever cette garantie.");
    } finally {
      setActing(false);
    }
  }

  if (error && !file) return <ErrorBanner message={error} />;
  if (!file) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">
        Wallet de {file.profile.firstName} {file.profile.lastName}
      </h1>
      <Link href={`/admin/clients/${userId}`} className="text-sm text-emerald-700">
        ← Fiche client
      </Link>

      <ErrorBanner message={error} />

      {!file.wallet && <p className="text-sm text-slate-500">Ce client n&apos;a pas encore de wallet.</p>}

      {file.wallet && (
        <>
          <Card className="flex flex-col gap-1 bg-emerald-700 text-white">
            <span className="text-sm text-emerald-100">Solde disponible</span>
            <span className="text-3xl font-bold">
              <PriceTag cents={file.wallet.balanceAvailableCents} />
            </span>
            {file.wallet.balanceReservedCents > 0 && (
              <span className="text-xs text-emerald-100">
                dont <PriceTag cents={file.wallet.balanceReservedCents} /> réservés
              </span>
            )}
          </Card>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-slate-500">Créditer</h2>
              <Field label="Montant (€)">
                <TextInput type="number" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} />
              </Field>
              <Field label="Motif">
                <TextInput value={creditReason} onChange={(e) => setCreditReason(e.target.value)} />
              </Field>
              <Button variant="secondary" onClick={handleCredit} disabled={acting || !creditAmount || !creditReason}>
                Créditer
              </Button>
            </Card>
            <Card className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-slate-500">Débiter</h2>
              <Field label="Montant (€)">
                <TextInput type="number" value={debitAmount} onChange={(e) => setDebitAmount(e.target.value)} />
              </Field>
              <Field label="Motif">
                <TextInput value={debitReason} onChange={(e) => setDebitReason(e.target.value)} />
              </Field>
              <Button variant="danger" onClick={handleDebit} disabled={acting || !debitAmount || !debitReason}>
                Débiter
              </Button>
            </Card>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-slate-500">Garanties (holds)</h2>
            {holds === null && <Spinner />}
            {holds?.length === 0 && <p className="text-xs text-slate-400">Aucune garantie.</p>}
            {holds?.map((h) => (
              <Card key={h.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    <PriceTag cents={h.amountCents} />
                  </p>
                  <p className="text-xs text-slate-500">
                    {h.status} · {formatDateTime(h.createdAt)}
                  </p>
                </div>
                {h.status === "ACTIVE" && (
                  <div className="flex gap-2">
                    <button onClick={() => handleRelease(h.id)} disabled={acting} className="text-xs text-slate-600">
                      Libérer
                    </button>
                    <button onClick={() => handleCapture(h.id)} disabled={acting} className="text-xs text-red-600">
                      Prélever
                    </button>
                  </div>
                )}
              </Card>
            ))}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-slate-500">Historique</h2>
            {transactions === null && <Spinner />}
            {transactions?.map((t) => (
              <Card key={t.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{TX_LABELS[t.type] ?? t.type}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(t.createdAt)}</p>
                  {t.reference && <p className="text-xs text-slate-400">{t.reference}</p>}
                </div>
                <span className={`font-semibold ${t.amountCents >= 0 ? "text-emerald-700" : "text-slate-900"}`}>
                  {t.amountCents >= 0 ? "+" : ""}
                  <PriceTag cents={t.amountCents} />
                </span>
              </Card>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
