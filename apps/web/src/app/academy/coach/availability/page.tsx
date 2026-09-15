"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { combineDateAndTimeToIso, formatTimeRange, nextNDays, formatDayLabel } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Field, Spinner, TextInput } from "@/components/ui";

interface AcademyAvailability {
  id: string;
  startAt: string;
  endAt: string;
}

const ROLES_ALLOWED = ["COACH", "STAFF", "ADMIN", "SUPER_ADMIN"];

/**
 * Academy Phase A — vue prof (besoin urgent §7) : saisie/consultation/
 * suppression de ses disponibilités. Consomme `/academy/teacher-availability`,
 * aucune récurrence encore côté UI (créneaux ponctuels — cf. ACADEMY_IMPLEMENTATION_PLAN.md).
 */
export default function CoachAvailabilityPage() {
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const [availabilities, setAvailabilities] = useState<AcademyAvailability[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = nextNDays(14);
  const rangeFrom = days[0]!.startOf("day").toUTC().toISO()!;
  const rangeTo = days[days.length - 1]!.endOf("day").toUTC().toISO()!;

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      router.push("/login?next=/academy/coach/availability");
      return;
    }
    if (!ROLES_ALLOWED.includes(user.role)) {
      setError("Accès réservé aux professeurs Academy.");
      return;
    }
    api
      .get<AcademyAvailability[]>(`/academy/teacher-availability?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`)
      .then(setAvailabilities)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les disponibilités."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sessionLoading, router]);

  async function reload() {
    const rows = await api.get<AcademyAvailability[]>(
      `/academy/teacher-availability?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
    );
    setAvailabilities(rows);
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/academy/teacher-availability/${id}`);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Suppression impossible.");
    }
  }

  if (sessionLoading) return <Spinner />;
  if (error && !availabilities) return <ErrorBanner message={error} />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Academy — Mes disponibilités</h1>
        <p className="mt-1 text-sm text-slate-400">
          Les créneaux ci-dessous sont proposés aux élèves invités. Le terrain n&apos;est jamais réservé automatiquement à ce stade.
        </p>
      </div>

      <ErrorBanner message={error} />

      <AvailabilityForm onCreated={reload} />

      <div className="flex flex-col gap-2">
        {availabilities === null && <Spinner />}
        {availabilities?.length === 0 && <p className="text-sm text-slate-400">Aucune disponibilité enregistrée pour les 14 prochains jours.</p>}
        {availabilities?.map((a) => (
          <Card key={a.id} className="flex items-center justify-between gap-3">
            <span className="text-sm">{formatTimeRange(a.startAt, a.endAt)}</span>
            <Button variant="danger" className="w-auto min-h-9 px-3 py-1.5 text-sm" onClick={() => handleDelete(a.id)}>
              Supprimer
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AvailabilityForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const days = nextNDays(14);
  const [date, setDate] = useState(days[0]!.toFormat("yyyy-MM-dd"));
  const [startTime, setStartTime] = useState("17:00");
  const [endTime, setEndTime] = useState("20:00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/academy/teacher-availability", {
        startAt: combineDateAndTimeToIso(date, startTime),
        endAt: combineDateAndTimeToIso(date, endTime),
      });
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
