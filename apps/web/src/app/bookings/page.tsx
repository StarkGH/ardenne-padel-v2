"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { formatDateTime } from "@/lib/datetime";
import { Card, PriceTag, Spinner } from "@/components/ui";
import type { Booking } from "@/lib/types";

const STATUS_LABELS: Record<string, string> = {
  CHECKOUT_PENDING: "En attente de paiement",
  PAYMENT_PENDING: "Paiement en cours",
  CONFIRMED: "Confirmée",
  CANCEL_PENDING: "Annulation en cours",
  CANCELED: "Annulée",
  FAILED: "Échouée",
  MANUAL_REVIEW: "En cours de vérification",
  COMPLETED: "Terminée",
};

// CDC §54 écran 12 — Mes réservations.
export default function BookingsPage() {
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[] | null>(null);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      router.push("/login?next=/bookings");
      return;
    }
    api.get<Booking[]>("/me/bookings").then(setBookings);
  }, [user, sessionLoading, router]);

  if (sessionLoading || !bookings) return <Spinner />;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Mes réservations</h1>
      {bookings.length === 0 && <p className="text-sm text-slate-500">Aucune réservation pour l&apos;instant.</p>}
      {bookings
        .slice()
        .sort((a, b) => b.startAt.localeCompare(a.startAt))
        .map((booking) => (
          <Link key={booking.id} href={`/bookings/${booking.id}`}>
            <Card className="flex items-center justify-between">
              <div>
                <p className="text-sm capitalize text-slate-400">{formatDateTime(booking.startAt)}</p>
                <p className="text-xs text-slate-500">{STATUS_LABELS[booking.status] ?? booking.status}</p>
              </div>
              <p className="font-semibold">
                <PriceTag cents={booking.priceTotalCents} currency={booking.currency} />
              </p>
            </Card>
          </Link>
        ))}
    </div>
  );
}
