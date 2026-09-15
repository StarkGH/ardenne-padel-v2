"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorBanner, Field, InfoBanner, TextInput } from "@/components/ui";

/**
 * Academy Phase A (§8) — un admin/staff crée une identité élève temporaire :
 * le lien d'accès (token) part uniquement par e-mail, jamais affiché ni
 * copiable ici (cf. ACADEMY_ARCHITECTURE.md §6 — aucune exposition du token brut côté staff).
 */
export default function AcademyInvitationsPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post("/academy/invitations", {
        firstName,
        lastName: lastName || undefined,
        email,
        phone: phone || undefined,
      });
      setSuccess(`Invitation envoyée à ${email}.`);
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer l'invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Academy — Invitations élève</h1>
        <p className="mt-1 text-sm text-slate-400">
          Crée un accès temporaire sécurisé (§8) : l&apos;élève reçoit un lien par e-mail lui permettant d&apos;encoder ses disponibilités, sans
          créer de compte Ardenne Padel V2.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <ErrorBanner message={error} />
          {success && <InfoBanner message={success} />}

          <Field label="Prénom">
            <TextInput value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </Field>
          <Field label="Nom (optionnel)">
            <TextInput value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
          <Field label="E-mail">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="GSM (optionnel)">
            <TextInput type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>

          <Button type="submit" disabled={submitting}>
            {submitting ? "Envoi..." : "Envoyer l'invitation"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
