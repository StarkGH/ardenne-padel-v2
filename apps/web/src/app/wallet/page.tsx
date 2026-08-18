"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { Button, Card, ErrorBanner, PriceTag, Spinner } from "@/components/ui";
import type { WalletBalance } from "@/lib/types";

// CDC §54 écran 15 — wallet / solde crédits.
export default function WalletPage() {
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      router.push("/login?next=/wallet");
      return;
    }
    api
      .get<WalletBalance>("/me/wallet")
      .then(setBalance)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le wallet."))
      .finally(() => setLoading(false));
  }, [user, sessionLoading, router]);

  if (sessionLoading || loading) return <Spinner />;
  if (!balance) return <ErrorBanner message={error} />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Mon wallet</h1>

      <Card className="flex flex-col gap-1 bg-primary-700 text-white">
        <span className="text-sm text-accent-100">Solde disponible</span>
        <span className="text-3xl font-bold">
          <PriceTag cents={balance.availableCents} currency={balance.currency} />
        </span>
        {balance.reservedCents > 0 && (
          <span className="text-xs text-accent-100">
            dont <PriceTag cents={balance.reservedCents} currency={balance.currency} /> réservés (garanties en cours)
          </span>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-500">Composition</h2>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Crédits payés</span>
          <span className="font-medium">
            <PriceTag cents={balance.byOrigin.PAID} currency={balance.currency} />
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Crédits bonus</span>
          <span className="font-medium">
            <PriceTag cents={balance.byOrigin.BONUS} currency={balance.currency} />
          </span>
        </div>
        {balance.byOrigin.ADMIN_COMP > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Crédits offerts</span>
            <span className="font-medium">
              <PriceTag cents={balance.byOrigin.ADMIN_COMP} currency={balance.currency} />
            </span>
          </div>
        )}
      </Card>

      <Link href="/wallet/packs">
        <Button>Acheter des crédits</Button>
      </Link>
      <Link href="/wallet/history">
        <Button variant="secondary">Historique</Button>
      </Link>
    </div>
  );
}
