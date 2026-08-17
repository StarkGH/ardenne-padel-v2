import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "@ardenne/config";

export interface RevenueDay {
  date: string;
  bookingsCount: number;
  revenueTotalCents: number;
  revenueExVatCents: number;
  vatCents: number;
}

export interface BookingsRevenueReport {
  from: string;
  to: string;
  vatRatePercent: number;
  days: RevenueDay[];
  summary: RevenueDay;
}

function toDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function splitVat(totalCents: number, vatRatePercent: number): { exVatCents: number; vatCents: number } {
  const exVatCents = Math.round(totalCents / (1 + vatRatePercent / 100));
  return { exVatCents, vatCents: totalCents - exVatCents };
}

/**
 * CDC V-018, voir `docs/tva.md` — chiffre d'affaires réservations pour la
 * déclaration TVA. Reconnaissance au moment de la confirmation
 * (`Booking.confirmedAt`), pas de la création ni du créneau joué : c'est le
 * seul instant qui vaut pour toutes les voies de paiement (Stripe, wallet,
 * mixte) sans compter deux fois une réservation payée par crédits (le débit
 * wallet ne crée pas de ligne `Payment`, contrairement au paiement carte —
 * baser le rapport sur `Payment` aurait donc sous-compté ces réservations).
 * Un seul taux (6 %) car le périmètre actuel de l'application ne vend que de
 * la location de terrain — voir `docs/tva.md` §3.2. Les remboursements ne
 * sont volontairement pas déduits ici (limitation documentée, pas une
 * omission silencieuse) : une réservation remboursée reste comptée au mois
 * de sa confirmation, comme le veut une compatibilité de caisse simple.
 */
export class ReportsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  async bookingsRevenue(from: Date, to: Date): Promise<BookingsRevenueReport> {
    const bookings = await this.db.booking.findMany({
      where: {
        status: { in: ["CONFIRMED", "COMPLETED"] },
        confirmedAt: { gte: from, lte: to },
      },
      select: { confirmedAt: true, priceTotalCents: true },
    });

    const vatRatePercent = this.config.BOOKING_VAT_RATE_PERCENT;
    const byDay = new Map<string, { bookingsCount: number; revenueTotalCents: number }>();
    for (const booking of bookings) {
      const key = toDayKey(booking.confirmedAt!);
      const entry = byDay.get(key) ?? { bookingsCount: 0, revenueTotalCents: 0 };
      entry.bookingsCount += 1;
      entry.revenueTotalCents += booking.priceTotalCents;
      byDay.set(key, entry);
    }

    const days: RevenueDay[] = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { bookingsCount, revenueTotalCents }]) => {
        const { exVatCents, vatCents } = splitVat(revenueTotalCents, vatRatePercent);
        return { date, bookingsCount, revenueTotalCents, revenueExVatCents: exVatCents, vatCents };
      });

    const summaryTotalCents = days.reduce((sum, d) => sum + d.revenueTotalCents, 0);
    const summarySplit = splitVat(summaryTotalCents, vatRatePercent);
    const summary: RevenueDay = {
      date: "TOTAL",
      bookingsCount: days.reduce((sum, d) => sum + d.bookingsCount, 0),
      revenueTotalCents: summaryTotalCents,
      revenueExVatCents: summarySplit.exVatCents,
      vatCents: summarySplit.vatCents,
    };

    return { from: from.toISOString(), to: to.toISOString(), vatRatePercent, days, summary };
  }
}
