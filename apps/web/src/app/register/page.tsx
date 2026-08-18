"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorBanner, Field, TextInput } from "@/components/ui";

// CDC §54 écran 5 — Inscription.
export default function RegisterPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/auth/register", { firstName, lastName, email, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Card className="flex flex-col gap-3">
        <h1 className="text-xl font-bold">Vérifiez votre e-mail</h1>
        <p className="text-sm text-slate-400">
          Un lien de vérification a été envoyé à <strong>{email}</strong>. Cliquez dessus pour activer votre compte, puis
          connectez-vous.
        </p>
        <Link href="/login" className="text-sm font-medium text-accent-600">
          Aller à la connexion
        </Link>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Créer un compte</h1>
      <ErrorBanner message={error} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Prénom">
          <TextInput required value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
        </Field>
        <Field label="Nom">
          <TextInput required value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
        </Field>
      </div>
      <Field label="E-mail">
        <TextInput required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </Field>
      <Field label="Mot de passe">
        <TextInput
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Création..." : "Créer mon compte"}
      </Button>
      <p className="text-center text-sm text-slate-400">
        Déjà inscrit ?{" "}
        <Link href="/login" className="font-medium text-accent-600">
          Se connecter
        </Link>
      </p>
    </form>
  );
}
