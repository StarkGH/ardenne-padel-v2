"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorBanner, Field, PriceTag, Spinner, TextInput } from "@/components/ui";
import type { AdminCreditPack } from "@/lib/types";

// CDC §55 écran 12 — packs de crédits.
export default function AdminCreditPacksPage() {
  const [packs, setPacks] = useState<AdminCreditPack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [paidCredits, setPaidCredits] = useState("");
  const [bonusCredits, setBonusCredits] = useState("0");
  const [displayOrder, setDisplayOrder] = useState("1");
  const [saving, setSaving] = useState(false);

  function load() {
    api
      .get<AdminCreditPack[]>("/admin/credit-packs")
      .then(setPacks)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les packs."));
  }

  useEffect(load, []);

  async function handleDeactivate(id: string) {
    try {
      await api.post(`/admin/credit-packs/${id}/deactivate`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de désactiver ce pack.");
    }
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/admin/credit-packs", {
        name,
        purchaseAmountCents: Math.round(Number(purchaseAmount) * 100),
        paidCreditsCents: Math.round(Number(paidCredits) * 100),
        bonusCreditsCents: Math.round(Number(bonusCredits) * 100),
        salesChannels: ["ONLINE", "KIOSK", "TERMINAL"],
        displayOrder: Number(displayOrder),
      });
      setShowForm(false);
      setName("");
      setPurchaseAmount("");
      setPaidCredits("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer ce pack.");
    } finally {
      setSaving(false);
    }
  }

  if (!packs) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Packs de crédits</h1>
      <ErrorBanner message={error} />

      <div className="flex flex-col gap-2">
        {packs.map((p) => (
          <Card key={p.id} className={`flex items-center justify-between gap-3 ${!p.active ? "opacity-50" : ""}`}>
            <div>
              <p className="text-sm font-medium">{p.name}</p>
              <p className="text-xs text-slate-500">
                <PriceTag cents={p.purchaseAmountCents} /> → <PriceTag cents={p.paidCreditsCents} />
                {p.bonusCreditsCents > 0 && (
                  <>
                    {" "}
                    + <PriceTag cents={p.bonusCreditsCents} /> offerts
                  </>
                )}
              </p>
            </div>
            {p.active && (
              <button onClick={() => handleDeactivate(p.id)} className="text-xs text-red-600">
                Désactiver
              </button>
            )}
          </Card>
        ))}
        {packs.length === 0 && <p className="text-sm text-slate-500">Aucun pack configuré.</p>}
      </div>

      {!showForm && <Button variant="secondary" onClick={() => setShowForm(true)}>Ajouter un pack</Button>}

      {showForm && (
        <Card className="flex flex-col gap-3">
          <Field label="Nom">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prix d'achat (€)">
              <TextInput type="number" value={purchaseAmount} onChange={(e) => setPurchaseAmount(e.target.value)} />
            </Field>
            <Field label="Crédits payés (€)">
              <TextInput type="number" value={paidCredits} onChange={(e) => setPaidCredits(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Crédits bonus (€)">
              <TextInput type="number" value={bonusCredits} onChange={(e) => setBonusCredits(e.target.value)} />
            </Field>
            <Field label="Ordre d'affichage">
              <TextInput type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={saving || !name || !purchaseAmount || !paidCredits}>
              {saving ? "..." : "Créer"}
            </Button>
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              Annuler
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
