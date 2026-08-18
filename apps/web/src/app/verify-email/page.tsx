"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Card, ErrorBanner, Spinner } from "@/components/ui";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("error");
      setError("Lien de vérification invalide.");
      return;
    }
    api
      .post("/auth/verify-email", { token })
      .then(() => setState("success"))
      .catch((err) => {
        setState("error");
        setError(err instanceof ApiError ? err.message : "Une erreur est survenue.");
      });
  }, [token]);

  if (state === "loading") return <Spinner />;

  if (state === "error") {
    return (
      <div className="flex flex-col gap-3">
        <ErrorBanner message={error} />
        <Link href="/login" className="text-sm font-medium text-accent-600">
          Aller à la connexion
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Compte vérifié !</h1>
      <p className="text-sm text-slate-400">Votre e-mail a été confirmé. Vous pouvez maintenant vous connecter.</p>
      <Link href="/login" className="text-sm font-medium text-accent-600">
        Se connecter
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Card>
      <Suspense fallback={<Spinner />}>
        <VerifyEmailContent />
      </Suspense>
    </Card>
  );
}
