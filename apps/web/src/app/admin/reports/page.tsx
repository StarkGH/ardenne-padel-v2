"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { api, ApiError } from "@/lib/api";
import { DISPLAY_TIMEZONE } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, PriceTag, Spinner } from "@/components/ui";
import type { BookingsRevenueReport } from "@/lib/types";

function toRangeIso(dateISO: string, endOfDay: boolean): string {
  const dt = DateTime.fromISO(dateISO, { zone: DISPLAY_TIMEZONE });
  return (endOfDay ? dt.endOf("day") : dt.startOf("day")).toUTC().toISO()!;
}

function formatEuros(cents: number): string {
  return (cents / 100).toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function downloadCsv(report: BookingsRevenueReport) {
  const header = ["Date", "Réservations", `TVAC (€)`, `HTVA (€)`, `TVA ${report.vatRatePercent}% (€)`];
  const rows = report.days.map((d) => [d.date, String(d.bookingsCount), formatEuros(d.revenueTotalCents), formatEuros(d.revenueExVatCents), formatEuros(d.vatCents)]);
  rows.push(["TOTAL", String(report.summary.bookingsCount), formatEuros(report.summary.revenueTotalCents), formatEuros(report.summary.revenueExVatCents), formatEuros(report.summary.vatCents)]);
  const csv = [header, ...rows].map((r) => r.join(";")).join("\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chiffre-affaires-reservations_${report.from.slice(0, 10)}_${report.to.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Rapport de chiffre d'affaires réservations pour la déclaration TVA (V-018, voir docs/tva.md).
export default function AdminReportsPage() {
  const startOfMonth = DateTime.now().setZone(DISPLAY_TIMEZONE).startOf("month").toISODate()!;
  const today = DateTime.now().setZone(DISPLAY_TIMEZONE).toISODate()!;
  const [from, setFrom] = useState(startOfMonth);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<BookingsRevenueReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<BookingsRevenueReport>(`/admin/reports/bookings-revenue?from=${encodeURIComponent(toRangeIso(from, false))}&to=${encodeURIComponent(toRangeIso(to, true))}`)
      .then(setReport)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le rapport."))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Chiffre d&apos;affaires — réservations</h1>
      <p className="text-sm text-slate-500">
        Recettes des réservations confirmées, ventilées TVAC/HTVA/TVA au taux de {report?.vatRatePercent ?? 6} % (droit d&apos;accès à une
        installation sportive — voir <code>docs/tva.md</code>). Périmètre actuel : location de terrain uniquement, wallet compris.
      </p>

      <Card className="flex flex-wrap items-end gap-3">
        <Field label="Du">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-11 rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white [color-scheme:dark]"
          />
        </Field>
        <Field label="Au">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="min-h-11 rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white [color-scheme:dark]"
          />
        </Field>
        <Button className="w-auto shrink-0" onClick={load} disabled={loading}>
          {loading ? "..." : "Actualiser"}
        </Button>
        {report && report.days.length > 0 && (
          <Button className="w-auto shrink-0" variant="secondary" onClick={() => downloadCsv(report)}>
            Exporter en CSV
          </Button>
        )}
      </Card>

      <ErrorBanner message={error} />

      {loading && !report && <Spinner />}

      {report && (
        <Card className="flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <p className="text-xs text-slate-500">Réservations</p>
              <p className="text-lg font-bold">{report.summary.bookingsCount}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">TVAC</p>
              <p className="text-lg font-bold">
                <PriceTag cents={report.summary.revenueTotalCents} />
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">HTVA</p>
              <p className="text-lg font-bold">
                <PriceTag cents={report.summary.revenueExVatCents} />
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">TVA ({report.vatRatePercent} %)</p>
              <p className="text-lg font-bold">
                <PriceTag cents={report.summary.vatCents} />
              </p>
            </div>
          </div>

          {report.days.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune réservation confirmée sur cette période.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2 text-right">Réservations</th>
                    <th className="py-2 pr-2 text-right">TVAC</th>
                    <th className="py-2 pr-2 text-right">HTVA</th>
                    <th className="py-2 text-right">TVA</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((d) => (
                    <tr key={d.date} className="border-b border-slate-800">
                      <td className="py-1.5 pr-2">{d.date}</td>
                      <td className="py-1.5 pr-2 text-right">{d.bookingsCount}</td>
                      <td className="py-1.5 pr-2 text-right">
                        <PriceTag cents={d.revenueTotalCents} />
                      </td>
                      <td className="py-1.5 pr-2 text-right">
                        <PriceTag cents={d.revenueExVatCents} />
                      </td>
                      <td className="py-1.5 text-right">
                        <PriceTag cents={d.vatCents} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
