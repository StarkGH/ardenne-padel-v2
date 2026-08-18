"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Card, ErrorBanner, Spinner } from "@/components/ui";
import type { AlertEntry, HealthIndicators } from "@/lib/types";

const INDICATOR_LABELS: Record<keyof HealthIndicators, string> = {
  lastLegacySyncAt: "Dernière synchro Legacy",
  legacySyncErrors: "Erreurs de synchro Legacy",
  bookingsManualReview: "Réservations en révision manuelle",
  paymentsFailed: "Paiements en échec",
  walletHoldsStale: "Garanties wallet expirées",
  creditPacksPaidNotCredited: "Packs payés non crédités",
  kioskDevicesOffline: "Kiosques hors ligne",
  terminalDevicesUnavailable: "Terminaux indisponibles",
  accessGrantsFailed: "Accès non provisionnés",
  notificationsFailed: "Notifications en échec",
};

// CDC §55 écran 2 — Dashboard.
export default function AdminDashboardPage() {
  const [indicators, setIndicators] = useState<HealthIndicators | null>(null);
  const [alerts, setAlerts] = useState<AlertEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get<HealthIndicators>("/admin/health-indicators"), api.get<AlertEntry[]>("/admin/alerts")])
      .then(([i, a]) => {
        setIndicators(i);
        setAlerts(a);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le tableau de bord."));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!indicators || !alerts) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Tableau de bord</h1>

      {alerts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-500">Alertes actives</h2>
          {alerts.map((a) => (
            <Card
              key={a.code}
              className={`flex items-center justify-between gap-3 ${
                a.severity === "critical" ? "border-red-700 bg-red-500/15" : "border-amber-700 bg-amber-500/15"
              }`}
            >
              <span className="text-sm">{a.message}</span>
              <span className="text-lg font-bold">{a.count}</span>
            </Card>
          ))}
        </section>
      )}
      {alerts.length === 0 && <p className="text-sm text-slate-500">Aucune alerte active.</p>}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-500">Indicateurs de santé</h2>
        <Card className="flex flex-col gap-2">
          {(Object.keys(INDICATOR_LABELS) as (keyof HealthIndicators)[]).map((key) => (
            <div key={key} className="flex items-center justify-between text-sm">
              <span className="text-slate-400">{INDICATOR_LABELS[key]}</span>
              <span className="font-medium">
                {key === "lastLegacySyncAt"
                  ? indicators.lastLegacySyncAt
                    ? formatDateTime(indicators.lastLegacySyncAt)
                    : "jamais"
                  : indicators[key]}
              </span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
