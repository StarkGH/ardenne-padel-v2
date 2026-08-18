"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Card, ErrorBanner, Spinner } from "@/components/ui";

// CDC §54 écran 18 — confirmation du changement d'e-mail (lien envoyé à la nouvelle adresse).
function EmailChangeConfirmContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [newEmail, setNewEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("error");
      setError("Lien de confirmation invalide.");
      return;
    }
    api
      .post<{ email: string }>("/auth/email-change/confirm", { token })
      .then((res) => {
        setNewEmail(res.email);
        setState("success");
      })
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
        <Link href="/profile" className="text-sm font-medium text-accent-600">
          Retour au profil
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Adresse e-mail mise à jour !</h1>
      <p className="text-sm text-slate-400">
        Votre nouvelle adresse <span className="font-medium">{newEmail}</span> est désormais confirmée.
      </p>
      <Link href="/profile" className="text-sm font-medium text-accent-600">
        Retour au profil
      </Link>
    </div>
  );
}

export default function EmailChangeConfirmPage() {
  return (
    <Card>
      <Suspense fallback={<Spinner />}>
        <EmailChangeConfirmContent />
      </Suspense>
    </Card>
  );
}
