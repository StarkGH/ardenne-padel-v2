import Link from "next/link";
import { Button, Card } from "@/components/ui";

// CDC §54 écran 1 — Accueil réservation.
export default function HomePage() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <p className="mb-1 text-xs font-semibold tracking-wide text-accent-600 uppercase">Bienvenue</p>
        <h1 className="text-2xl font-bold">Réservez votre terrain</h1>
        <p className="mt-2 text-slate-400">Padel simple ou double, en quelques secondes.</p>
      </Card>

      <Link href="/book">
        <Button>Réserver un terrain</Button>
      </Link>

      <Card>
        <h2 className="mb-2 text-lg font-semibold">Comment ça marche</h2>
        <ol className="list-inside list-decimal space-y-1 text-sm text-slate-400">
          <li>Choisissez votre terrain et votre créneau</li>
          <li>Connectez-vous ou créez un compte</li>
          <li>Payez en ligne, en toute sécurité</li>
          <li>Recevez votre confirmation et votre code d&apos;accès</li>
        </ol>
      </Card>
    </div>
  );
}
