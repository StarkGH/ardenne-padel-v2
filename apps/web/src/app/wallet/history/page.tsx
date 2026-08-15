"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { formatDateTime } from "@/lib/datetime";
import { Card, ErrorBanner, PriceTag, Spinner } from "@/components/ui";
import type { WalletTransaction, WalletTransactionType } from "@/lib/types";

const TYPE_LABELS: Record<WalletTransactionType, string> = {
  CREDIT_PACK_PURCHASE: "Achat de crédits",
  CREDIT_PACK_BONUS: "Crédits bonus",
  CREDIT_ADMIN: "Crédit offert",
  DEBIT_BOOKING: "Réservation réglée",
  REFUND_BOOKING: "Remboursement",
  HOLD_CREATED: "Garantie réservée",
  HOLD_RELEASED: "Garantie libérée",
  HOLD_CAPTURED: "Garantie prélevée",
  ADJUSTMENT: "Ajustement",
  BONUS_EXPIRY: "Expiration de bonus",
};

// Écritures d'audit sur les holds — ne changent jamais le solde réel (CDC §28.5), affichées différemment.
const HOLD_AUDIT_TYPES = new Set<WalletTransactionType>(["HOLD_CREATED", "HOLD_RELEASED", "HOLD_CAPTURED"]);

// CDC §54 écran 17 — historique wallet.
export default function WalletHistoryPage() {
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const [transactions, setTransactions] = useState<WalletTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      router.push("/login?next=/wallet/history");
      return;
    }
    api
      .get<WalletTransaction[]>("/me/wallet/transactions")
      .then(setTransactions)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger l'historique."));
  }, [user, sessionLoading, router]);

  if (sessionLoading || !transactions) return <Spinner />;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Historique wallet</h1>
      <ErrorBanner message={error} />
      {transactions.length === 0 && <p className="text-sm text-slate-500">Aucun mouvement pour l&apos;instant.</p>}
      {transactions.map((tx) => {
        const isHoldAudit = HOLD_AUDIT_TYPES.has(tx.type);
        return (
          <Card key={tx.id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{TYPE_LABELS[tx.type] ?? tx.type}</p>
              <p className="text-xs text-slate-500">{formatDateTime(tx.createdAt)}</p>
            </div>
            <p className={`font-semibold ${isHoldAudit ? "text-slate-400" : tx.amountCents >= 0 ? "text-emerald-700" : "text-slate-900"}`}>
              {tx.amountCents >= 0 && !isHoldAudit ? "+" : ""}
              <PriceTag cents={tx.amountCents} />
            </p>
          </Card>
        );
      })}
    </div>
  );
}
