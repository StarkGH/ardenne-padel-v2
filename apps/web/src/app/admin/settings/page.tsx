"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { Card, ErrorBanner, InfoBanner, Spinner } from "@/components/ui";
import type { AdminSettings } from "@/lib/types";

function Row({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{typeof value === "boolean" ? (value ? "Activé" : "Désactivé") : value}</span>
    </div>
  );
}

// CDC §55 écrans 17-18-25 — configuration paiement partagé, frais de service
// split, paramètres généraux. Instantané en lecture seule : la config est
// aujourd'hui 100% par variable d'environnement (ADR-0025), aucune édition
// possible depuis cet écran sans redéploiement.
export default function AdminSettingsPage() {
  const { user } = useSession();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== "SUPER_ADMIN") return;
    api
      .get<AdminSettings>("/admin/settings")
      .then(setSettings)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les paramètres."));
  }, [user]);

  if (user && user.role !== "SUPER_ADMIN") {
    return <ErrorBanner message="Réservé aux super-administrateurs." />;
  }
  if (error) return <ErrorBanner message={error} />;
  if (!settings) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Paramètres</h1>
      <InfoBanner message="Configuration en lecture seule — toute modification nécessite un changement de variable d'environnement et un redéploiement (aucun stockage persisté à ce jour)." />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Paiement partagé</h2>
        <Card className="flex flex-col gap-2">
          <Row label="Paiement partagé activé" value={settings.split.paymentSplitEnabled} />
          <Row label="Frais de service activés" value={settings.split.serviceFeeEnabled} />
          <Row label="Montant des frais" value={`${(settings.split.serviceFeeCents / 100).toFixed(2)} €`} />
          <Row label="Répartition des frais" value={settings.split.serviceFeeAllocation} />
          <Row label="Durée de validité des invitations" value={`${settings.split.invitationTtlHours} h`} />
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Wallet</h2>
        <Card className="flex flex-col gap-2">
          <Row label="Wallet activé" value={settings.wallet.enabled} />
          <Row label="Rechargement activé" value={settings.wallet.topupEnabled} />
          <Row label="Seuil garantie bloquée" value={`${settings.wallet.holdStaleHours} h`} />
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Paiement</h2>
        <Card className="flex flex-col gap-2">
          <Row label="Terminal activé" value={settings.payments.terminalEnabled} />
          <Row label="QR handoff activé" value={settings.payments.qrHandoffEnabled} />
          <Row label="Tap to Pay activé" value={settings.payments.tapToPayEnabled} />
          <Row label="Garantie carte hors session" value={settings.payments.offSessionGuaranteeEnabled} />
          <Row label="Garantie wallet" value={settings.payments.walletGuaranteeEnabled} />
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Accès</h2>
        <Card className="flex flex-col gap-2">
          <Row label="Accès V2 activé" value={settings.access.v2AccessEnabled} />
          <Row label="Marge avant créneau" value={`${settings.access.enabledBeforeMinutes} min`} />
          <Row label="Marge après créneau" value={`${settings.access.enabledAfterMinutes} min`} />
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Kiosque</h2>
        <Card className="flex flex-col gap-2">
          <Row label="Durée de session QR" value={`${settings.kiosk.sessionTtlMinutes} min`} />
          <Row label="Seuil hors ligne" value={`${settings.kiosk.offlineThresholdMinutes} min`} />
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Legacy Doinsport</h2>
        <Card className="flex flex-col gap-2">
          <Row label="Mode" value={settings.legacy.mode} />
          <Row label="Synchronisation activée" value={settings.legacy.syncEnabled} />
          <Row label="Écriture activée" value={settings.legacy.writeEnabled} />
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Pilote</h2>
        <Card className="flex flex-col gap-2">
          <Row label="Mode cohorte pilote activé" value={settings.pilot.pilotModeEnabled} />
        </Card>
      </section>
    </div>
  );
}
