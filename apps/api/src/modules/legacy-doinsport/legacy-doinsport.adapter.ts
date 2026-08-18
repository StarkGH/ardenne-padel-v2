import { AppError } from "@ardenne/shared";
import type { AppConfig } from "@ardenne/config";
import { DoinsportHttpClient } from "./http-client.js";
import { LegacyDoinsportRepository } from "./legacy-doinsport.repository.js";
import { LegacyApiError, LegacyErrorCodes, mapLegacyError } from "./legacy-errors.js";
import { resolveUserClubId } from "./userclub-resolver.js";
import {
  NoPriceForDurationError,
  NoTimetableBlockCoversTimeError,
  resolveBlockPrice,
  toLegacyPriceReference,
  type TimetableBlockDto,
  type TimetableBlockPriceDto,
} from "./pricing-resolver.js";
import type {
  DateRange,
  LegacyAuth,
  LegacyBookingDto,
  LegacyBookingProvider,
  LegacyBookingSummaryDto,
  LegacyCancelOptions,
  LegacyClientDto,
  LegacyCourtDto,
  LegacyCreateBooking,
  LegacyPriceInput,
  LegacyPriceReference,
} from "./types.js";

function extractCollection(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = res as Record<string, unknown> | null;
  if (Array.isArray(r?.data)) return r.data as Record<string, unknown>[];
  if (Array.isArray(r?.["hydra:member"])) return r["hydra:member"] as Record<string, unknown>[];
  if (Array.isArray(r?.items)) return r.items as Record<string, unknown>[];
  return [];
}

function idFromIri(iri: string): string {
  return iri.split("/").pop() ?? iri;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Implémentation `LegacyBookingProvider` (CDC §12.1). C'est la seule classe
 * du système autorisée à connaître les endpoints HTTP Doinsport, le format
 * IRI API Platform et les structures `hydra:member` — tout le reste de
 * l'application ne manipule que les DTOs de `types.ts`.
 */
export class LegacyDoinsportAdapter implements LegacyBookingProvider {
  private readonly http: DoinsportHttpClient;

  constructor(
    private readonly config: AppConfig,
    private readonly repo: LegacyDoinsportRepository,
  ) {
    this.http = new DoinsportHttpClient(config, repo);
  }

  private async withLegacyErrorMapping<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof LegacyApiError) throw mapLegacyError(err);
      throw err;
    }
  }

  async authenticateClub(): Promise<LegacyAuth> {
    return this.withLegacyErrorMapping(() => this.http.authenticateClub());
  }

  private async currentUserClubId(): Promise<string> {
    const token = (await this.repo.getLatestToken()) ?? (await this.authenticateClub()).token;
    return resolveUserClubId(token, this.config.DOINSPORT_USERCLUB_ID);
  }

  async listClients(): Promise<LegacyClientDto[]> {
    return this.withLegacyErrorMapping(async () => {
      const perPage = 200;
      let page = 1;
      const all: Record<string, unknown>[] = [];

      // Pagination par taille de page, pas par `totalItems` : `/clubs/clients`
      // renvoie parfois un tableau brut sans total (confirmé en direct,
      // ADR-0031) — se fier à `totalItems`/`hydra:totalItems` a fait
      // s'arrêter l'import après la première page dans ce cas, perdant
      // silencieusement tous les clients au-delà de `perPage`. Une page plus
      // courte que `perPage` signale la fin, indépendamment de tout champ de
      // total. Garde-fou anti-boucle infinie conservé (CDC §86).
      for (let guard = 0; guard < 200; guard++) {
        const res = await this.http.call(`/clubs/clients`, {
          "club.id": this.http.clubId,
          itemsPerPage: perPage,
          page,
          getTotalItems: "true",
        });
        const batch = extractCollection(res);
        all.push(...batch);
        if (batch.length < perPage) break;
        page += 1;
      }

      const dtos: LegacyClientDto[] = [];
      for (const raw of all) {
        const user = (raw.user ?? raw.userClient ?? {}) as Record<string, unknown>;
        const dto: LegacyClientDto = {
          id: str(raw.id ?? user.id),
          firstName: str(raw.firstName ?? user.firstName),
          lastName: str(raw.lastName ?? user.lastName),
          email: str(raw.email ?? user.email),
          gsm: str(raw.phoneNumber ?? raw.gsm ?? user.phoneNumber ?? user.gsm),
        };
        dtos.push(dto);
        await this.repo.upsertLegacyClient({
          externalId: dto.id,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email || null,
          phone: dto.gsm || null,
        });
      }
      return dtos;
    });
  }

  async listBookings(range: DateRange): Promise<LegacyBookingSummaryDto[]> {
    return this.withLegacyErrorMapping(async () => {
      // L'endpoint `/clubs/bookings/listing` ne se fie pas qu'à
      // `startAt[after]`/`startAt[before]` : sans `filter[status]`, il ne
      // renvoie que les réservations à venir, quelle que soit la fenêtre de
      // dates demandée (confirmé en le testant en direct : fenêtre passée
      // pure → 0 résultat). Il faut donc deux appels distincts, un par sens
      // temporel, comme le fait l'outil `padel-service` (implémentation de
      // référence) — jamais un seul appel "et on verra bien".
      const [past, future] = await Promise.all([
        this.fetchBookingsPage(range, "before", "desc"),
        this.fetchBookingsPage(range, "after", "asc"),
      ]);

      // Dédoublonnage par id : les deux fenêtres peuvent se chevaucher
      // légèrement autour de "maintenant" selon le moment exact de l'appel.
      const byId = new Map<string, Record<string, unknown>>();
      for (const b of [...past, ...future]) byId.set(str(b.id), b);

      // CDC §13.3 : le filtre temporel du listing est peu fiable, on le
      // réapplique donc localement (ne jamais faire confiance à l'API seule).
      const fromMs = Date.parse(range.fromISO);
      const toMs = Date.parse(range.toISO);
      return [...byId.values()]
        .map((b) => ({
          id: str(b.id),
          startAt: str(b.startAt),
          endAt: str(b.endAt),
          canceled: Boolean(b.canceled ?? b.canceledAt),
        }))
        .filter((b) => {
          const startMs = Date.parse(b.startAt);
          return Number.isFinite(startMs) && startMs >= fromMs && startMs <= toMs;
        });
    });
  }

  private async fetchBookingsPage(
    range: DateRange,
    statusFilter: "before" | "after",
    sortOrder: "asc" | "desc",
  ): Promise<Record<string, unknown>[]> {
    const perPage = 200;
    let page = 1;
    const all: Record<string, unknown>[] = [];

    // Pagination par taille de page — voir le commentaire équivalent dans
    // `listClients()` : ne pas se fier à un `totalItems` absent ou peu
    // fiable.
    for (let guard = 0; guard < 200; guard++) {
      const res = await this.http.call(`/clubs/bookings/listing`, {
        "club.id": this.http.clubId,
        itemsPerPage: perPage,
        page,
        canceled: "true",
        confirmed: "true",
        getTotalItems: "true",
        "filter[status]": statusFilter,
        "order[booking.startAt]": sortOrder,
        "startAt[after]": range.fromISO,
        "startAt[before]": range.toISO,
      });
      const batch = extractCollection(res);
      all.push(...batch);
      if (batch.length < perPage) break;
      page += 1;
    }
    return all;
  }

  /**
   * CDC §55 écran 3 — décompte réel côté Doinsport, tous terrains et toutes
   * dates confondus (pas borné à ce que V2 a déjà synchronisé). Réutilise
   * le filtre `participants.client.id` (confirmé fonctionnel en direct) et
   * le même découpage passé/futur que `listBookings()` — sans lui,
   * `filter[status]` par défaut n'expose que le futur. Ne récupère qu'un
   * item par page (`itemsPerPage: 1`) : seul `totalItems` nous intéresse.
   */
  async countActiveBookingsForClient(legacyClientId: string): Promise<number> {
    return this.withLegacyErrorMapping(async () => {
      const baseParams = {
        "club.id": this.http.clubId,
        itemsPerPage: 1,
        page: 1,
        canceled: "false",
        getTotalItems: "true",
        "participants.client.id": legacyClientId,
        "startAt[after]": "2015-01-01T00:00:00.000Z",
        "startAt[before]": "2035-01-01T00:00:00.000Z",
      };
      const [before, after] = await Promise.all([
        this.http.call<Record<string, unknown>>(`/clubs/bookings/listing`, { ...baseParams, "filter[status]": "before" }),
        this.http.call<Record<string, unknown>>(`/clubs/bookings/listing`, { ...baseParams, "filter[status]": "after" }),
      ]);
      return num(before.totalItems) + num(after.totalItems);
    });
  }

  async getBooking(id: string): Promise<LegacyBookingDto> {
    return this.withLegacyErrorMapping(async () => {
      const raw = await this.http.call<Record<string, unknown>>(`/clubs/bookings/${id}`);
      return this.normalizeBooking(raw);
    });
  }

  private normalizeBooking(raw: Record<string, unknown>): LegacyBookingDto {
    const playgrounds = Array.isArray(raw.playgrounds) ? (raw.playgrounds as Record<string, unknown>[]) : [];
    const participants = Array.isArray(raw.participants) ? (raw.participants as Record<string, unknown>[]) : [];
    const owner = participants.find((p) => p.bookingOwner === true);
    const ownerClient = owner?.client as Record<string, unknown> | null | undefined;
    return {
      id: str(raw.id),
      startAt: str(raw.startAt),
      endAt: str(raw.endAt),
      canceled: Boolean(raw.canceled),
      comment: typeof raw.comment === "string" ? raw.comment : null,
      playgroundIds: playgrounds.map((p) => str(p.id)),
      accessCodes: Array.isArray(raw.accessCodes) ? (raw.accessCodes as LegacyBookingDto["accessCodes"]) : [],
      bookingOwnerClientId: ownerClient?.id ? str(ownerClient.id) : null,
      raw,
    };
  }

  async listCourts(): Promise<LegacyCourtDto[]> {
    return this.withLegacyErrorMapping(async () => {
      const res = await this.http.call(`/clubs/playgrounds`, {
        "club.id": this.http.clubId,
        itemsPerPage: 10,
        page: 1,
      });
      return extractCollection(res).map((p) => ({ id: str(p.id), name: str(p.name) }));
    });
  }

  private async requireCourtMapping(courtId: string) {
    const mapping = await this.repo.findCourtMappingByLocalCourtId(courtId);
    if (!mapping || !mapping.active) {
      throw new AppError(
        LegacyErrorCodes.LEGACY_COURT_NOT_MAPPED,
        "Ce terrain n'est pas relié au système de réservation Legacy.",
        500,
        { courtId },
      );
    }
    return mapping;
  }

  private async fetchTimetableBlocks(legacyPlaygroundId: string): Promise<TimetableBlockDto[]> {
    const timetablesRes = await this.http.call(`/clubs/playgrounds/timetables`, {
      "club.id": this.http.clubId,
      itemsPerPage: 500,
      page: 1,
      "playgrounds.id": legacyPlaygroundId,
    });
    const timetableIds = extractCollection(timetablesRes)
      .map((t) => str(t.id) || idFromIri(str(t["@id"])))
      .filter(Boolean);

    if (!timetableIds.length) return [];

    const blocksRes = await this.http.call(`/clubs/playgrounds/timetables/blocks`, {
      itemsPerPage: 500,
      page: 1,
      "timetable.id[]": timetableIds,
    });

    return extractCollection(blocksRes).map((b) => ({
      id: str(b.id),
      startAt: str(b.startAt),
      endAt: str(b.endAt),
      createdAt: str(b.createdAt),
      priceIds: (Array.isArray(b.prices) ? (b.prices as unknown[]) : []).map((p) =>
        typeof p === "string" ? idFromIri(p) : str((p as Record<string, unknown>)?.id),
      ),
    }));
  }

  private async fetchPrices(legacyPlaygroundId: string, legacyActivityId: string): Promise<TimetableBlockPriceDto[]> {
    const res = await this.http.call(`/clubs/playgrounds/timetables/blocks/prices`, {
      "playground.id": legacyPlaygroundId,
      "activity.id[]": legacyActivityId,
      itemsPerPage: 200,
      page: 1,
    });
    return extractCollection(res).map((p) => ({
      id: str(p.id),
      pricePerParticipant: typeof p.pricePerParticipant === "number" ? p.pricePerParticipant : null,
      duration: Number(p.duration),
    }));
  }

  async resolveLegacyPrice(input: LegacyPriceInput): Promise<LegacyPriceReference> {
    return this.withLegacyErrorMapping(async () => {
      const mapping = await this.requireCourtMapping(input.courtId);
      const [blocks, prices] = await Promise.all([
        this.fetchTimetableBlocks(mapping.legacyPlaygroundId),
        this.fetchPrices(mapping.legacyPlaygroundId, mapping.legacyActivityId),
      ]);

      try {
        const resolved = resolveBlockPrice({ blocks, prices, startAt: input.startAt, durationSeconds: input.durationSeconds });
        return toLegacyPriceReference(resolved, mapping.legacyActivityId);
      } catch (err) {
        if (err instanceof NoTimetableBlockCoversTimeError || err instanceof NoPriceForDurationError) {
          throw new AppError(LegacyErrorCodes.LEGACY_PRICE_NOT_FOUND, "Aucun tarif Legacy résolu pour ce créneau.", 502, {
            reason: err.message,
          });
        }
        throw err;
      }
    });
  }

  async createBooking(input: LegacyCreateBooking): Promise<LegacyBookingDto> {
    return this.withLegacyErrorMapping(async () => {
      const mapping = await this.requireCourtMapping(input.courtId);

      let timetableBlockPriceId = input.timetableBlockPriceId;
      if (!timetableBlockPriceId) {
        const durationSeconds = Math.round((Date.parse(input.endAt) - Date.parse(input.startAt)) / 1000);
        const resolved = await this.resolveLegacyPrice({ courtId: input.courtId, startAt: input.startAt, durationSeconds });
        timetableBlockPriceId = resolved.timetableBlockPriceId;
      }

      const userClubId = await this.currentUserClubId();

      const body = {
        id: null,
        name: null,
        startAt: input.startAt,
        endAt: input.endAt,
        activity: `/activities/${mapping.legacyActivityId}`,
        category: null,
        timetableBlockPrice: `/clubs/playgrounds/timetables/blocks/prices/${timetableBlockPriceId}`,
        participants: [
          {
            client: `/clubs/clients/${input.legacyClientId}`,
            subscriptionCard: null,
            category: null,
            inQueue: false,
            bookingOwner: true,
          },
        ],
        // CDC §16.1 : marqueur de corrélation APV2:<booking_uuid> dans un champ non destructif.
        comment: input.correlationMarker,
        clientNote: null,
        playgrounds: [`/clubs/playgrounds/${mapping.legacyPlaygroundId}`],
        recurrence: null,
        fromRecurrence: null,
        participantsQueueEnabled: false,
        client: null,
        club: `/clubs/${this.http.clubId}`,
        creationOrigin: "administration",
        paymentMethod: input.paymentMethod ?? "on_the_spot",
        playgroundOptions: [],
        nameManuallyUpdated: null,
        coachVisibleOnline: null,
        minAgeLimitation: null,
        maxAgeLimitation: null,
        userClub: `/user-clubs/${userClubId}`,
      };

      const raw = await this.http.call<Record<string, unknown>>(`/clubs/bookings`, {}, { method: "POST", body });
      return this.normalizeBooking(raw);
    });
  }

  async cancelBooking(id: string, options: LegacyCancelOptions): Promise<LegacyBookingDto> {
    return this.withLegacyErrorMapping(async () => {
      const raw = await this.http.call<Record<string, unknown>>(
        `/clubs/bookings/${id}`,
        {},
        { method: "PUT", body: { canceled: true, withRefund: options.withRefund } },
      );
      return this.normalizeBooking(raw);
    });
  }
}

export { LegacyDoinsportRepository };
