"use client";

import { CreditPacksPurchase } from "@/components/credit-packs-purchase";

// CDC §54 écran 16 — achat d'un pack de crédits.
export default function CreditPacksPage() {
  return (
    <CreditPacksPurchase
      title="Acheter des crédits"
      loginNext="/wallet/packs"
      confirmedHref="/wallet"
      confirmedLabel="Voir mon wallet"
    />
  );
}
