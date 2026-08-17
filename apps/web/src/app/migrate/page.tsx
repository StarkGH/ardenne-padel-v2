"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorBanner, Field, Spinner, TextInput } from "@/components/ui";

interface InviteIdentity {
  firstName: string;
  lastName: string;
  email: string | null;
}

// CDC §7.3 — migration d'un compte Doinsport ("Shadow Client") vers un compte V2, depuis le lien d'invitation reçu par e-mail.
function MigrateContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<"loading" | "form" | "success" | "error">("loading");
  const [identity, setIdentity] = useState<InviteIdentity | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("error");
      setError("Lien d'invitation invalide.");
      return;
    }
    api
      .post<InviteIdentity>("/auth/migration-invite/validate", { token })
      .then((res) => {
        setIdentity(res);
        setState("form");
      })
      .catch((err) => {
        setState("error");
        setError(err instanceof ApiError ? err.message : "Une erreur est survenue.");
      });
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/auth/migration-invite/confirm", { token, password });
      setState("success");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state === "loading") return <Spinner />;

  if (state === "error") {
    return (
      <div className="flex flex-col gap-3">
        <ErrorBanner message={error} />
        <Link href="/login" className="text-sm font-medium text-emerald-700">
          Aller à la connexion
        </Link>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-bold">Compte créé !</h1>
        <p className="text-sm text-slate-600">
          Votre compte Ardenne Padel est prêt. Vos anciennes réservations et informations client sont conservées.
        </p>
        <Link href="/login" className="text-sm font-medium text-emerald-700">
          Se connecter
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Créer votre mot de passe</h1>
      <p className="text-sm text-slate-600">
        Bienvenue {identity!.firstName} {identity!.lastName}. Choisissez un mot de passe pour activer votre compte
        Ardenne Padel ({identity!.email}) — vos anciennes réservations restent associées à ce compte.
      </p>
      <ErrorBanner message={error} />
      <Field label="Mot de passe (10 caractères minimum)">
        <TextInput
          required
          type="password"
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Création..." : "Activer mon compte"}
      </Button>
    </form>
  );
}

export default function MigratePage() {
  return (
    <Card>
      <Suspense fallback={<Spinner />}>
        <MigrateContent />
      </Suspense>
    </Card>
  );
}
