"use client";

import { CreditPacksPurchase } from "@/components/credit-packs-purchase";

// CDC §54.1 écran 8 — achat/recharge de crédits au bar. Le client s'identifie
// directement sur la tablette (comme pour "Payer ici", ADR-0023) puis achète
// depuis le même flux que le parcours client (ADR-0025 §wallets : pas de
// construction dupliquée d'un second moteur d'achat pour le kiosque).
export default function KioskCreditsPage() {
  return (
    <CreditPacksPurchase
      title="Acheter ou recharger des crédits"
      loginNext="/kiosk/credits"
      confirmedHref="/kiosk"
      confirmedLabel="Retour à l'accueil kiosque"
    />
  );
}
