"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Card, ErrorBanner, PriceTag, Spinner } from "@/components/ui";
import type { AdminCreditPackPurchase } from "@/lib/types";

const STATUS_LABELS: Record<string, string> = { PENDING: "En attente", PAID: "Payé", CREDITED: "Crédité", FAILED: "Échec" };

// CDC §55 écran 13 — achats de crédits, tous clients confondus.
export default function AdminCreditPackPurchasesPage() {
  const [purchases, setPurchases] = useState<AdminCreditPackPurchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AdminCreditPackPurchase[]>("/admin/credit-pack-purchases")
      .then(setPurchases)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les achats."));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!purchases) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Achats de crédits</h1>
      <div className="flex flex-col gap-2">
        {purchases.map((p) => (
          <Card key={p.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{p.creditPack?.name ?? p.creditPackId}</p>
              <p className="text-xs text-slate-500">
                {p.user ? `${p.user.firstName} ${p.user.lastName}` : p.userId} · {formatDateTime(p.createdAt)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium">
                <PriceTag cents={p.purchaseAmountCents} />
              </p>
              <p className="text-xs text-slate-500">{STATUS_LABELS[p.status] ?? p.status}</p>
            </div>
          </Card>
        ))}
        {purchases.length === 0 && <p className="text-sm text-slate-500">Aucun achat.</p>}
      </div>
    </div>
  );
}
