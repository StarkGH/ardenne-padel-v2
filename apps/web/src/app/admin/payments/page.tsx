"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, InfoBanner, PriceTag, Spinner, TextInput } from "@/components/ui";
import type { AdminPayment } from "@/lib/types";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  REQUIRES_ACTION: "Action requise",
  AUTHORIZED: "Autorisé",
  SUCCEEDED: "Réussi",
  FAILED: "Échec",
  CANCELED: "Annulé",
};

// CDC §55 écrans 15-16 — paiements/remboursements et coûts provider réels.
export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<AdminPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [acting, setActing] = useState(false);

  function load() {
    api
      .get<AdminPayment[]>("/admin/payments")
      .then(setPayments)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les paiements."));
  }

  useEffect(load, []);

  async function handleRefund(paymentId: string) {
    if (!refundAmount) return;
    setActing(true);
    setError(null);
    setUnconfigured(false);
    try {
      await api.post(`/admin/payments/${paymentId}/refund`, { amountCents: Math.round(Number(refundAmount) * 100), reason: refundReason || undefined });
      setRefundingId(null);
      setRefundAmount("");
      setRefundReason("");
      load();
    } catch (err) {
      if (err instanceof ApiError && err.code === "STRIPE_NOT_CONFIGURED") {
        setUnconfigured(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Impossible de rembourser ce paiement.");
      }
    } finally {
      setActing(false);
    }
  }

  if (error) return <ErrorBanner message={error} />;
  if (!payments) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Paiements</h1>
      {unconfigured && (
        <InfoBanner message="Le paiement en ligne n'est pas encore configuré pour ce club (aucun compte Stripe actif pour l'instant)." />
      )}
      <div className="flex flex-col gap-2">
        {payments.map((p) => (
          <Card key={p.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {p.user ? `${p.user.firstName} ${p.user.lastName}` : p.userId} · {p.paymentChannel}
                </p>
                <p className="text-xs text-slate-500">{formatDateTime(p.createdAt)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">
                  <PriceTag cents={p.amountCents} currency={p.currency} />
                </p>
                <p className="text-xs text-slate-500">{STATUS_LABELS[p.status] ?? p.status}</p>
              </div>
            </div>
            {(p.providerFeeCents !== null || p.providerNetCents !== null) && (
              <p className="text-xs text-slate-400">
                {p.providerFeeCents !== null && <>Frais provider : <PriceTag cents={p.providerFeeCents} currency={p.currency} /> · </>}
                {p.providerNetCents !== null && <>Net : <PriceTag cents={p.providerNetCents} currency={p.currency} /></>}
              </p>
            )}
            {p.refunds && p.refunds.length > 0 && (
              <p className="text-xs text-slate-400">{p.refunds.length} remboursement(s) déjà émis.</p>
            )}
            {p.status === "SUCCEEDED" && refundingId !== p.id && (
              <button onClick={() => setRefundingId(p.id)} className="self-start text-xs text-red-600">
                Rembourser
              </button>
            )}
            {refundingId === p.id && (
              <div className="flex flex-col gap-2 border-t border-slate-800 pt-2">
                <Field label="Montant (€)">
                  <TextInput type="number" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
                </Field>
                <Field label="Motif (optionnel)">
                  <TextInput value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
                </Field>
                <div className="flex gap-2">
                  <Button variant="danger" onClick={() => handleRefund(p.id)} disabled={acting || !refundAmount}>
                    {acting ? "..." : "Confirmer le remboursement"}
                  </Button>
                  <Button variant="secondary" onClick={() => setRefundingId(null)}>
                    Annuler
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))}
        {payments.length === 0 && <p className="text-sm text-slate-500">Aucun paiement.</p>}
      </div>
    </div>
  );
}
