"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { Button, Card, ErrorBanner, Field, TextInput } from "@/components/ui";
import type { AuthUser, Role } from "@/lib/types";

const ADMIN_ROLES: Role[] = ["STAFF", "ADMIN", "SUPER_ADMIN"];

// CDC §55 écran 1 — Login admin. Même endpoint que la connexion client
// (aucun mécanisme d'auth distinct côté backend, ADR-0024) ; un compte
// CUSTOMER est refusé ici et déconnecté immédiatement.
function AdminLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { refresh } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/admin/dashboard";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await api.post<AuthUser>("/auth/login", { email, password });
      if (!ADMIN_ROLES.includes(user.role)) {
        await api.post("/auth/logout");
        setError("Ce compte n'a pas accès à l'espace équipe.");
        setSubmitting(false);
        return;
      }
      await refresh();
      router.push(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Espace équipe</h1>
      <ErrorBanner message={error} />
      <Field label="E-mail">
        <TextInput required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </Field>
      <Field label="Mot de passe">
        <TextInput
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </Field>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Connexion..." : "Se connecter"}
      </Button>
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <Card>
      <Suspense fallback={null}>
        <AdminLoginForm />
      </Suspense>
    </Card>
  );
}
