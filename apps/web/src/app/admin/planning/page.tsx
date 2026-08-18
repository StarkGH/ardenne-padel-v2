"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { DISPLAY_TIMEZONE } from "@/lib/datetime";
import { Button, Card, ErrorBanner, Spinner } from "@/components/ui";
import type { AdminBooking, Court, LegacyOccupation, LegacyOccupationParticipant, RevenueByChannel } from "@/lib/types";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  CHECKOUT_PENDING: "En attente de paiement",
  LEGACY_HOLD_PENDING: "Retenue Legacy",
  PAYMENT_PENDING: "Paiement en cours",
  CONFIRMED: "Confirmée",
  CANCEL_PENDING: "Annulation en cours",
  COMPLETED: "Terminée",
  FAILED: "Échec",
  MANUAL_REVIEW: "Révision manuelle",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "border-slate-600 bg-slate-800 text-slate-200",
  CHECKOUT_PENDING: "border-amber-700 bg-amber-500/15 text-amber-300",
  LEGACY_HOLD_PENDING: "border-amber-700 bg-amber-500/15 text-amber-300",
  PAYMENT_PENDING: "border-amber-700 bg-amber-500/15 text-amber-300",
  CONFIRMED: "border-accent-700 bg-accent-600/15 text-accent-300",
  CANCEL_PENDING: "border-orange-700 bg-orange-500/15 text-orange-300",
  COMPLETED: "border-slate-600 bg-slate-800 text-slate-400",
  FAILED: "border-red-700 bg-red-500/15 text-red-300",
  MANUAL_REVIEW: "border-red-700 bg-red-500/15 text-red-300",
};

const SLOT_MINUTES = 30;
const DEFAULT_START_MIN = 8 * 60;
const DEFAULT_END_MIN = 23 * 60 + 30;

function minutesOfDay(iso: string): number {
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(DISPLAY_TIMEZONE);
  return dt.hour * 60 + dt.minute;
}

function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "Alain Monfort (101) / Alain Samray (80)" — le texte s'enroule ensuite sur autant de lignes que la cellule le permet (voir `maxParticipantLines`), coupé seulement s'il en reste plus que la place disponible. */
function formatParticipants(participants: LegacyOccupationParticipant[]): string {
  return participants.map((p) => `${p.firstName} ${p.lastName} (${p.activeBookingsCount})`).join(" / ");
}

const ROW_HEIGHT_PX = 28; // doit rester synchronisé avec gridTemplateRows plus bas
const CELL_VERTICAL_PADDING_PX = 4; // py-0.5 (2px haut + 2px bas)
const TEXT_LINE_HEIGHT_PX = 14; // text-[11px] leading-tight
const SOURCE_LABEL_LINES = 1; // ligne "Doinsport" réservée en bas de cellule
const NOTE_LINES = 1; // ligne de note réservée si la réservation en a une

/** Nombre de lignes disponibles pour les participants une fois la hauteur réelle de la cellule (fonction du nb de demi-heures), la ligne "Doinsport" du bas et l'éventuelle note prises en compte. */
function maxParticipantLines(rowSpan: number, hasNote: boolean): number {
  const cellHeightPx = rowSpan * ROW_HEIGHT_PX - CELL_VERTICAL_PADDING_PX;
  const reservedLines = SOURCE_LABEL_LINES + (hasNote ? NOTE_LINES : 0);
  const availablePx = cellHeightPx - reservedLines * TEXT_LINE_HEIGHT_PX;
  return Math.max(1, Math.floor(availablePx / TEXT_LINE_HEIGHT_PX));
}

interface OccupiedRange {
  courtId: string;
  startAt: string;
  endAt: string;
}

/** Taux de remplissage d'un terrain sur une fenêtre [fromMin, toMin) — nb de créneaux de 30 min occupés (V2 + Doinsport) sur le nombre total de créneaux de la fenêtre. */
function computeOccupancy(courtId: string, ranges: OccupiedRange[], fromMin: number, toMin: number): { occupied: number; total: number } {
  const total = Math.max(0, Math.round((toMin - fromMin) / SLOT_MINUTES));
  const occupiedSlots = new Set<number>();
  for (const r of ranges) {
    if (r.courtId !== courtId) continue;
    const rStart = Math.max(minutesOfDay(r.startAt), fromMin);
    const rEnd = Math.min(minutesOfDay(r.endAt), toMin);
    if (rEnd <= rStart) continue;
    const startSlot = Math.floor((rStart - fromMin) / SLOT_MINUTES);
    const endSlot = Math.ceil((rEnd - fromMin) / SLOT_MINUTES);
    for (let s = startSlot; s < endSlot; s++) occupiedSlots.add(s);
  }
  return { occupied: occupiedSlots.size, total };
}

function formatOccupancy(o: { occupied: number; total: number }): string {
  const pct = o.total > 0 ? Math.round((o.occupied / o.total) * 100) : 0;
  return `${pct}% (${o.occupied}/${o.total})`;
}

/** Même formatage que `/admin/reports` (`formatEuros`) — cohérence visuelle entre les deux écrans. */
function formatEuros(cents: number): string {
  return (cents / 100).toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function totalCents(r: RevenueByChannel): number {
  return r.stripeCents + r.walletCents + r.doinsportCents;
}

/** "180,00 € (Stripe 100,00 € · Wallet 20,00 € · Doinsport 60,00 €)" */
function formatRevenueBreakdown(r: RevenueByChannel): string {
  return `${formatEuros(totalCents(r))} (Stripe ${formatEuros(r.stripeCents)} · Wallet ${formatEuros(r.walletCents)} · Doinsport ${formatEuros(r.doinsportCents)})`;
}

/** Même chose que `computeOccupancy` mais tous terrains confondus (somme des créneaux occupés/disponibles de chaque terrain). */
function computeGlobalOccupancy(courtIds: string[], ranges: OccupiedRange[], fromMin: number, toMin: number): { occupied: number; total: number } {
  return courtIds.reduce(
    (acc, courtId) => {
      const o = computeOccupancy(courtId, ranges, fromMin, toMin);
      return { occupied: acc.occupied + o.occupied, total: acc.total + o.total };
    },
    { occupied: 0, total: 0 },
  );
}

// CDC §55 écran 3 — Planning multi-terrains. Grille horaire, une colonne par
// terrain (voir ADR-0030) : fenêtre 07h-23h par défaut, étendue si une
// réservation réelle déborde. Créneaux libres cliquables vers la création
// admin, pré-remplie (terrain/date/heure) — pas de vérification de
// disponibilité par cellule (coûteux, N appels), la sélection manuelle de
// créneau côté formulaire reste le filet de sécurité si le créneau cliqué
// n'est en fait plus libre.
export default function AdminPlanningPage() {
  const router = useRouter();
  const [dateISO, setDateISO] = useState(() => DateTime.now().setZone(DISPLAY_TIMEZONE).toISODate()!);
  const [courts, setCourts] = useState<Court[]>([]);
  // Mesurée réellement plutôt que devinée en pixels : l'en-tête de colonnes
  // (sticky, dans la grille) doit se caler juste sous la barre de date
  // (sticky, au-dessus) — un décalage codé en dur s'est révélé faux à
  // l'usage (l'en-tête colonnes chevauchait la ligne 8h-9h de la grille).
  const dateBarRef = useRef<HTMLDivElement>(null);
  const [dateBarHeight, setDateBarHeight] = useState(0);
  // Synchronisation manuelle du défilement horizontal entre l'en-tête (sticky, hors du conteneur à défilement) et le corps de la grille.
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [legacyOccupations, setLegacyOccupations] = useState<LegacyOccupation[] | null>(null);
  // Chiffre d'affaires jour/semaine/mois, ventilé par canal (Stripe/wallet
  // côté V2, Doinsport) — calculé et agrégé côté serveur (voir
  // `/admin/revenue-by-channel`), reconnu par date de jeu (startAt, cohérent
  // avec le planning) et non par date de confirmation (Booking.confirmedAt,
  // utilisée par /admin/reports pour la déclaration TVA — sémantique
  // différente et volontairement pas réutilisée ici).
  const [revenueByChannel, setRevenueByChannel] = useState<{ day: RevenueByChannel; week: RevenueByChannel; month: RevenueByChannel } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mesurée après coup plutôt que devinée en pixels : l'en-tête de colonnes
  // (sticky, calé juste sous cette barre) doit suivre sa vraie hauteur, qui
  // varie une fois les données (remplissage, CA) chargées et ajoutent des
  // lignes. Dépend explicitement de ce qui fait varier son contenu plutôt
  // que de compter sur un `ResizeObserver` (constaté peu fiable en direct
  // pour ce changement de taille précis, cause non identifiée).
  useLayoutEffect(() => {
    if (dateBarRef.current) setDateBarHeight(dateBarRef.current.offsetHeight);
  }, [bookings, revenueByChannel, courts]);

  useEffect(() => {
    api.get<Court[]>("/courts").then(setCourts).catch(() => {});
  }, []);

  useEffect(() => {
    const from = DateTime.fromISO(dateISO, { zone: DISPLAY_TIMEZONE }).startOf("day").toUTC().toISO();
    const to = DateTime.fromISO(dateISO, { zone: DISPLAY_TIMEZONE }).endOf("day").toUTC().toISO();
    setBookings(null);
    setLegacyOccupations(null);
    api
      .get<AdminBooking[]>(`/admin/bookings?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`)
      .then(setBookings)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le planning."));
    api
      .get<LegacyOccupation[]>(`/admin/legacy-bookings?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`)
      .then(setLegacyOccupations)
      .catch(() => setLegacyOccupations([])); // dégradé silencieusement — pas bloquant pour afficher le reste du planning
  }, [dateISO]);

  // Ventilation Stripe/wallet/Doinsport calculée côté serveur (voir
  // `bookings-admin.service.ts#revenueByChannel`) — un appel par période
  // plutôt qu'un fetch de toutes les réservations du mois pour resommer côté
  // client : la ventilation nécessite de croiser `Payment`/`WalletTransaction`,
  // coûteux à répliquer sans un aller-retour réseau par réservation.
  useEffect(() => {
    const base = DateTime.fromISO(dateISO, { zone: DISPLAY_TIMEZONE });
    const fetchRange = (start: DateTime, end: DateTime) =>
      api.get<RevenueByChannel>(`/admin/revenue-by-channel?from=${encodeURIComponent(start.toUTC().toISO()!)}&to=${encodeURIComponent(end.toUTC().toISO()!)}`);
    setRevenueByChannel(null);
    Promise.all([
      fetchRange(base.startOf("day"), base.endOf("day")),
      fetchRange(base.startOf("week"), base.endOf("week")),
      fetchRange(base.startOf("month"), base.endOf("month")),
    ])
      .then(([day, week, month]) => setRevenueByChannel({ day, week, month }))
      .catch(() => {}); // dégradé silencieusement — le CA jour/semaine/mois n'est pas bloquant pour le reste du planning
  }, [dateISO]);

  const activeBookings = useMemo(() => (bookings ?? []).filter((b) => b.status !== "CANCELED"), [bookings]);
  const legacyBlocks = useMemo(() => legacyOccupations ?? [], [legacyOccupations]);

  const { startMin, endMin, slotCount } = useMemo(() => {
    let start = DEFAULT_START_MIN;
    let end = DEFAULT_END_MIN;
    for (const b of activeBookings) {
      start = Math.min(start, Math.floor(minutesOfDay(b.startAt) / 60) * 60);
      end = Math.max(end, Math.ceil(minutesOfDay(b.endAt) / 60) * 60);
    }
    for (const l of legacyBlocks) {
      start = Math.min(start, Math.floor(minutesOfDay(l.startAt) / 60) * 60);
      end = Math.max(end, Math.ceil(minutesOfDay(l.endAt) / 60) * 60);
    }
    return { startMin: start, endMin: end, slotCount: (end - start) / SLOT_MINUTES };
  }, [activeBookings, legacyBlocks]);

  // Taux de remplissage par terrain : V2 + Doinsport confondus (occupation réelle du terrain, peu importe l'origine de la réservation).
  const occupiedRanges: OccupiedRange[] = useMemo(
    () => [
      ...activeBookings.map((b) => ({ courtId: b.courtId, startAt: b.startAt, endAt: b.endAt })),
      ...legacyBlocks.map((l) => ({ courtId: l.courtId, startAt: l.startAt, endAt: l.endAt })),
    ],
    [activeBookings, legacyBlocks],
  );

  // Taux de remplissage global (tous terrains confondus) affiché à côté de la date.
  const globalWindowOccupancy = useMemo(
    () => computeGlobalOccupancy(courts.map((c) => c.id), occupiedRanges, DEFAULT_START_MIN, DEFAULT_END_MIN),
    [courts, occupiedRanges],
  );
  const globalDayOccupancy = useMemo(
    () => computeGlobalOccupancy(courts.map((c) => c.id), occupiedRanges, startMin, endMin),
    [courts, occupiedRanges, startMin, endMin],
  );

  function goToNewBooking(courtId: string, slotStartMin: number) {
    const params = new URLSearchParams({ courtId, date: dateISO, time: minutesToLabel(slotStartMin) });
    router.push(`/admin/bookings/new?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Planning multi-terrains</h1>
        <Link href="/admin/bookings/new">
          <Button className="w-auto shrink-0" variant="secondary">
            + Nouvelle réservation
          </Button>
        </Link>
      </div>
      {/* Figé au scroll (voir aussi l'en-tête de la grille plus bas, calé juste en dessous) — bords étendus jusqu'aux marges de `main` (px-4/md:px-8) pour ne pas laisser transparaître le contenu qui défile derrière. */}
      <div ref={dateBarRef} className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-1 bg-[#050912] px-4 py-2 md:-mx-8 md:px-8">
        <button
          type="button"
          onClick={() => setDateISO(DateTime.fromISO(dateISO).minus({ days: 1 }).toISODate()!)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-600 text-lg text-slate-400 hover:bg-slate-800"
          aria-label="Jour précédent"
        >
          ←
        </button>
        <input
          type="date"
          value={dateISO}
          onChange={(e) => setDateISO(e.target.value)}
          className="min-h-11 w-fit rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white [color-scheme:dark]"
        />
        <button
          type="button"
          onClick={() => setDateISO(DateTime.fromISO(dateISO).plus({ days: 1 }).toISODate()!)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-600 text-lg text-slate-400 hover:bg-slate-800"
          aria-label="Jour suivant"
        >
          →
        </button>
        <span className="text-sm font-medium capitalize text-slate-400">
          {DateTime.fromISO(dateISO).setLocale("fr").toFormat("cccc d MMMM")}
        </span>
        {bookings && courts.length > 0 && (
          <span className="text-xs text-slate-500">
            Remplissage global — 8h-23h30 : <span className="font-medium text-slate-300">{formatOccupancy(globalWindowOccupancy)}</span> · Journée :{" "}
            <span className="font-medium text-slate-300">{formatOccupancy(globalDayOccupancy)}</span>
          </span>
        )}
        {/* CA reconnu par date de jeu (startAt), pas par date de confirmation (voir /admin/reports pour la TVA). Ventilé par canal : Stripe/wallet côté V2 (Payment/WalletTransaction), Doinsport (priceDueCents, prix de vente, encaissé ou non). Doit rester à l'intérieur du conteneur mesuré par `dateBarRef` (voir ADR-0030 addendum 4) : en sortir casserait le calage de l'en-tête colonnes en dessous. */}
        {revenueByChannel && (
          <div className="flex basis-full flex-col gap-0.5 text-xs text-slate-500" title="Chiffre d'affaires par date de jeu, ventilé par canal de paiement">
            <p>
              CA jour : <span className="font-medium text-slate-300">{formatRevenueBreakdown(revenueByChannel.day)}</span>
            </p>
            <p>
              CA semaine : <span className="font-medium text-slate-300">{formatRevenueBreakdown(revenueByChannel.week)}</span>
            </p>
            <p>
              CA mois : <span className="font-medium text-slate-300">{formatRevenueBreakdown(revenueByChannel.month)}</span>
            </p>
          </div>
        )}
      </div>

      <ErrorBanner message={error} />
      {!bookings && !error && <Spinner />}

      {/* En-tête colonnes hors du conteneur à défilement horizontal du corps, exprès : `overflow-x: auto` fait basculer `overflow-y` en véritable conteneur de scroll (règle CSS, non contournable même avec `overflow-y: visible` explicite — constaté en direct), ce qui casse le `sticky` de tout ce qui est à l'intérieur. Conteneur sticky séparé (même mécanisme que la barre de date) + défilement horizontal du corps recopié dessus en JS (onScroll) pour garder les colonnes alignées. */}
      {bookings && courts.length > 0 && (
        <>
          <div className="sticky z-20 overflow-hidden" style={{ top: dateBarHeight }} ref={headerScrollRef}>
            <div
              className="grid gap-px bg-slate-700 text-xs"
              style={{ gridTemplateColumns: `56px repeat(${courts.length}, minmax(140px, 1fr))` }}
            >
              <div className="bg-slate-900" />
              {courts.map((court) => {
                const windowOccupancy = computeOccupancy(court.id, occupiedRanges, DEFAULT_START_MIN, DEFAULT_END_MIN);
                const dayOccupancy = computeOccupancy(court.id, occupiedRanges, startMin, endMin);
                return (
                  <div key={court.id} className="flex flex-col items-center justify-center gap-0.5 bg-slate-900 px-2 py-1 text-center">
                    <span className="text-sm font-semibold text-slate-200">{court.name}</span>
                    <span className="text-[10px] leading-none text-slate-400" title="Taux de remplissage entre 8h et 23h30">
                      8h-23h30 : {formatOccupancy(windowOccupancy)}
                    </span>
                    <span className="text-[10px] leading-none text-slate-500" title="Taux de remplissage sur l'ensemble de la journée affichée">
                      Journée : {formatOccupancy(dayOccupancy)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="overflow-x-auto"
            ref={bodyScrollRef}
            onScroll={() => {
              if (headerScrollRef.current && bodyScrollRef.current) headerScrollRef.current.scrollLeft = bodyScrollRef.current.scrollLeft;
            }}
          >
          <div
            className="grid gap-px bg-slate-700 text-xs"
            style={{
              gridTemplateColumns: `56px repeat(${courts.length}, minmax(140px, 1fr))`,
              gridTemplateRows: `repeat(${slotCount}, 28px)`,
            }}
          >
            {Array.from({ length: slotCount }, (_, slot) => {
              const slotStartMin = startMin + slot * SLOT_MINUTES;
              const showLabel = slotStartMin % 60 === 0;
              return (
                <div
                  key={`label-${slot}`}
                  className="sticky left-0 z-10 flex items-start justify-end bg-slate-900 pr-1 pt-0.5 text-[10px] text-slate-400"
                  style={{ gridColumn: 1, gridRow: slot + 1 }}
                >
                  {showLabel ? minutesToLabel(slotStartMin) : ""}
                </div>
              );
            })}

            {courts.map((court, courtIdx) => {
              const courtBookings = activeBookings.filter((b) => b.courtId === court.id);
              const occupied = new Set<number>();
              const blocks = courtBookings.map((b) => {
                const bStart = Math.max(minutesOfDay(b.startAt), startMin);
                const bEnd = Math.min(minutesOfDay(b.endAt), endMin);
                const startSlot = Math.floor((bStart - startMin) / SLOT_MINUTES);
                const endSlot = Math.ceil((bEnd - startMin) / SLOT_MINUTES);
                for (let s = startSlot; s < endSlot; s++) occupied.add(s);
                return { booking: b, startSlot, endSlot };
              });
              const courtLegacyBlocks = legacyBlocks
                .filter((l) => l.courtId === court.id)
                .map((l) => {
                  const lStart = Math.max(minutesOfDay(l.startAt), startMin);
                  const lEnd = Math.min(minutesOfDay(l.endAt), endMin);
                  const startSlot = Math.floor((lStart - startMin) / SLOT_MINUTES);
                  const endSlot = Math.ceil((lEnd - startMin) / SLOT_MINUTES);
                  for (let s = startSlot; s < endSlot; s++) occupied.add(s);
                  return { occupation: l, startSlot, endSlot };
                });

              return (
                <div key={court.id} style={{ display: "contents" }}>
                  {blocks.map(({ booking, startSlot, endSlot }) => (
                    <Link
                      key={booking.id}
                      href={`/admin/bookings/${booking.id}`}
                      className={`overflow-hidden rounded border px-1.5 py-0.5 text-[11px] leading-tight ${STATUS_COLORS[booking.status] ?? "border-slate-600 bg-slate-900"}`}
                      style={{ gridColumn: courtIdx + 2, gridRow: `${startSlot + 1} / ${endSlot + 1}` }}
                    >
                      <p className="truncate font-medium">
                        {booking.organizer ? `${booking.organizer.firstName} ${booking.organizer.lastName}` : "Client inconnu"}
                      </p>
                      <p className="truncate text-slate-500">{STATUS_LABELS[booking.status] ?? booking.status}</p>
                    </Link>
                  ))}
                  {courtLegacyBlocks.map(({ occupation, startSlot, endSlot }) => {
                    const participantsLabel = occupation.participants.length > 0 ? formatParticipants(occupation.participants) : occupation.clientName ?? "Client Doinsport";
                    const rowSpan = endSlot - startSlot;
                    const hasNote = Boolean(occupation.comment);
                    return (
                      <div
                        key={occupation.id}
                        title={`${participantsLabel}${occupation.fullyPaid ? "" : " — paiement incomplet"}${occupation.comment ? ` — Note : ${occupation.comment}` : ""} — réservation Doinsport, non modifiable depuis Ardenne Padel V2`}
                        className="flex h-full flex-col justify-between overflow-hidden rounded border border-dashed border-purple-700 bg-[repeating-linear-gradient(45deg,theme(colors.purple.950),theme(colors.purple.950)_4px,theme(colors.slate.900)_4px,theme(colors.slate.900)_8px)] px-1.5 py-0.5 text-[11px] leading-tight text-purple-300"
                        style={{ gridColumn: courtIdx + 2, gridRow: `${startSlot + 1} / ${endSlot + 1}` }}
                      >
                        <p
                          className="font-medium"
                          style={{ display: "-webkit-box", WebkitLineClamp: maxParticipantLines(rowSpan, hasNote), WebkitBoxOrient: "vertical", overflow: "hidden" }}
                        >
                          {!occupation.fullyPaid && <span aria-label="Paiement incomplet">⚠️ </span>}
                          {participantsLabel}
                        </p>
                        {hasNote && (
                          <p
                            className="shrink-0 italic text-purple-200"
                            style={{ display: "-webkit-box", WebkitLineClamp: NOTE_LINES, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                          >
                            {occupation.comment}
                          </p>
                        )}
                        {/* Dernière ligne de la cellule : signale que ce bloc vient de la synchro Doinsport, jamais une réservation créée depuis V2 (celles-ci s'affichent avec leur statut réel, style plein, plus haut). */}
                        <p className="shrink-0 truncate text-purple-400">Doinsport</p>
                      </div>
                    );
                  })}
                  {Array.from({ length: slotCount }, (_, slot) =>
                    occupied.has(slot) ? null : (
                      <button
                        key={`empty-${slot}`}
                        onClick={() => goToNewBooking(court.id, startMin + slot * SLOT_MINUTES)}
                        className="bg-slate-900 hover:bg-accent-600/15"
                        style={{ gridColumn: courtIdx + 2, gridRow: slot + 1 }}
                        title={`Créer une réservation à ${minutesToLabel(startMin + slot * SLOT_MINUTES)}`}
                      />
                    ),
                  )}
                </div>
              );
            })}
          </div>
          </div>
        </>
      )}

      {bookings && courts.length === 0 && <p className="text-sm text-slate-500">Aucun terrain configuré.</p>}
    </div>
  );
}
