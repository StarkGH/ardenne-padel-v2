"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { combineDateAndTimeToIso, formatTimeRange, nextNDays, formatDayLabel } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, InfoBanner, Spinner, TextInput } from "@/components/ui";

interface InvitationInfo {
  firstName: string;
  email: string;
}

interface AcademyAvailability {
  id: string;
  startAt: string;
  endAt: string;
}

/**
 * Academy Phase A — parcours élève (besoin urgent §8, §9) : accès uniquement
 * par ce lien à token temporaire, aucun compte V2 requis. Le token brut
 * (`params.token`) est transmis en en-tête `X-Academy-Token` sur chaque
 * appel — jamais en query string (évite qu'il finisse dans des logs).
 */
export default function AcademyInvitationPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const headers = { "X-Academy-Token": token };

  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [availabilities, setAvailabilities] = useState<AcademyAvailability[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const days = nextNDays(14);
  const rangeFrom = days[0]!.startOf("day").toUTC().toISO()!;
  const rangeTo = days[days.length - 1]!.endOf("day").toUTC().toISO()!;

  useEffect(() => {
    api
      .get<InvitationInfo>(`/academy/invitations/${token}`)
      .then((info) => {
        setInvitation(info);
        return api.get<AcademyAvailability[]>(
          `/academy/student-availability?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
          headers,
        );
      })
      .then(setAvailabilities)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Ce lien n'est plus valide."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function reload() {
    const rows = await api.get<AcademyAvailability[]>(
      `/academy/student-availability?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
      headers,
    );
    setAvailabilities(rows);
  }

  if (loading) return <Spinner />;
  if (!invitation) return <ErrorBanner message={error ?? "Lien invalide."} />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Bonjour {invitation.firstName} 👋</h1>
        <p className="mt-1 text-sm text-slate-400">
          Indique tes disponibilités pour un cours à l&apos;Academy. Un membre de l&apos;équipe te proposera un créneau dès qu&apos;un prof et un
          terrain correspondent.
        </p>
      </div>

      <ErrorBanner message={error} />

      <CourseRequestForm token={token} />

      <AvailabilityForm token={token} onCreated={reload} />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-300">Mes disponibilités</h2>
        {availabilities.length === 0 && <p className="text-sm text-slate-400">Aucune disponibilité renseignée pour l&apos;instant.</p>}
        {availabilities.map((a) => (
          <Card key={a.id} className="flex items-center justify-between gap-3">
            <span className="text-sm">{formatTimeRange(a.startAt, a.endAt)}</span>
            <Button
              variant="danger"
              className="w-auto min-h-9 px-3 py-1.5 text-sm"
              onClick={() =>
                api
                  .delete(`/academy/student-availability/${a.id}`, headers)
                  .then(reload)
                  .catch((err) => setError(err instanceof ApiError ? err.message : "Suppression impossible."))
              }
            >
              Supprimer
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CourseRequestForm({ token }: { token: string }) {
  const [requestedHours, setRequestedHours] = useState("1");
  const [courseType, setCourseType] = useState<"INDIVIDUAL" | "GROUP">("INDIVIDUAL");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/academy/course-requests", { requestedHours: Number(requestedHours), courseType }, { "X-Academy-Token": token });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer la demande.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-slate-300">Ma demande de cours</h2>
        <ErrorBanner message={error} />
        {success && <InfoBanner message="Demande enregistrée." />}
        <Field label="Nombre d'heures souhaitées">
          <TextInput type="number" min="0.5" step="0.5" value={requestedHours} onChange={(e) => setRequestedHours(e.target.value)} required />
        </Field>
        <Field label="Type de cours">
          <select
            value={courseType}
            onChange={(e) => setCourseType(e.target.value as "INDIVIDUAL" | "GROUP")}
            className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white"
          >
            <option value="INDIVIDUAL">Individuel</option>
            <option value="GROUP">À plusieurs</option>
          </select>
        </Field>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Envoi..." : "Enregistrer ma demande"}
        </Button>
      </form>
    </Card>
  );
}

function AvailabilityForm({ token, onCreated }: { token: string; onCreated: () => Promise<void> }) {
  const days = nextNDays(14);
  const [date, setDate] = useState(days[0]!.toFormat("yyyy-MM-dd"));
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("20:00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(
        "/academy/student-availability",
        { startAt: combineDateAndTimeToIso(date, startTime), endAt: combineDateAndTimeToIso(date, endTime) },
        { "X-Academy-Token": token },
      );
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce créneau.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-slate-300">Ajouter une disponibilité</h2>
        <ErrorBanner message={error} />
        <Field label="Jour">
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white"
          >
            {days.map((d) => (
              <option key={d.toISODate()} value={d.toFormat("yyyy-MM-dd")}>
                {formatDayLabel(d)}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="De">
            <TextInput type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </Field>
          <Field label="À">
            <TextInput type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
          </Field>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Ajout..." : "Ajouter ce créneau"}
        </Button>
      </form>
    </Card>
  );
}
