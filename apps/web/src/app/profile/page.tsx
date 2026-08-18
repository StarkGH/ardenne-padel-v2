"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { formatDate } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, Spinner, TextInput } from "@/components/ui";
import type { Profile } from "@/lib/types";

// CDC §54 écran 18 — profil.
export default function ProfilePage() {
  const { user, loading: sessionLoading, logoutAll } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      router.push("/login?next=/profile");
      return;
    }
    api
      .get<Profile>("/me/profile")
      .then(setProfile)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le profil."))
      .finally(() => setLoading(false));
  }, [user, sessionLoading, router]);

  if (sessionLoading || loading) return <Spinner />;
  if (!profile) return <ErrorBanner message={error} />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Mon profil</h1>

      <Card className="flex flex-col gap-1">
        <p className="text-sm text-slate-500">E-mail</p>
        <p className="text-base font-medium">{profile.email}</p>
        <p className="mt-2 text-xs text-slate-400">Membre depuis le {formatDate(profile.createdAt)}</p>
      </Card>

      <ProfileForm profile={profile} onUpdated={setProfile} />
      <EmailChangeForm currentEmail={profile.email} />
      <PasswordForm />

      <Link href="/profile/payment-methods">
        <Button variant="secondary">Gérer mes moyens de paiement</Button>
      </Link>

      <Button
        variant="danger"
        onClick={() => {
          void logoutAll().then(() => router.push("/"));
        }}
      >
        Se déconnecter partout
      </Button>
    </div>
  );
}

function ProfileForm({ profile, onUpdated }: { profile: Profile; onUpdated: (p: Profile) => void }) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.patch<Profile>("/me/profile", { firstName, lastName, phone: phone || undefined });
      onUpdated(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer le profil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-slate-500">Informations personnelles</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Prénom">
          <TextInput required value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
        </Field>
        <Field label="Nom">
          <TextInput required value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
        </Field>
      </div>
      <Field label="Téléphone">
        <TextInput type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
      </Field>
      <ErrorBanner message={error} />
      {saved && <p className="text-sm text-accent-600">Profil mis à jour.</p>}
      <Button type="submit" variant="secondary" disabled={saving}>
        {saving ? "Enregistrement..." : "Enregistrer"}
      </Button>
    </form>
  );
}

function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.post("/me/profile/email-change", { newEmail, currentPassword });
      setNewEmail("");
      setCurrentPassword("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de demander le changement d'e-mail.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-slate-500">Adresse e-mail</h2>
      <p className="text-xs text-slate-400">Adresse actuelle : {currentEmail}</p>
      <Field label="Nouvelle adresse e-mail">
        <TextInput required type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" />
      </Field>
      <Field label="Mot de passe actuel">
        <TextInput
          required
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
        />
      </Field>
      <ErrorBanner message={error} />
      {saved && (
        <p className="text-sm text-accent-600">
          Un e-mail de confirmation a été envoyé à la nouvelle adresse. Le changement prendra effet une fois le lien
          confirmé.
        </p>
      )}
      <Button type="submit" variant="secondary" disabled={saving}>
        {saving ? "Envoi..." : "Changer l'adresse e-mail"}
      </Button>
    </form>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.post("/auth/password/change", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de changer le mot de passe.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-slate-500">Mot de passe</h2>
      <Field label="Mot de passe actuel">
        <TextInput
          required
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
        />
      </Field>
      <Field label="Nouveau mot de passe">
        <TextInput
          required
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <ErrorBanner message={error} />
      {saved && <p className="text-sm text-accent-600">Mot de passe modifié.</p>}
      <Button type="submit" variant="secondary" disabled={saving}>
        {saving ? "Modification..." : "Changer le mot de passe"}
      </Button>
    </form>
  );
}
