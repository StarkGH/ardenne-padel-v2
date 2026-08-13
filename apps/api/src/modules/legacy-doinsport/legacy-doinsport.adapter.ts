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
      let total: number | null = null;
      const all: Record<string, unknown>[] = [];

      // Garde-fou anti-boucle infinie si l'API renvoie un total incohérent (CDC §86).
      for (let guard = 0; guard < 200; guard++) {
        const res = await this.http.call(`/clubs/clients`, {
          "club.id": this.http.clubId,
          itemsPerPage: perPage,
          page,
          getTotalItems: "true",
        });
        const batch = extractCollection(res);
        if (total === null) {
          const r = res as Record<string, unknown>;
          total = Number(r.totalItems ?? r["hydra:totalItems"] ?? batch.length);
        }
        all.push(...batch);
        if (!batch.length || all.length >= total) break;
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
      const perPage = 200;
      let page = 1;
      let total: number | null = null;
      const all: Record<string, unknown>[] = [];

      for (let guard = 0; guard < 200; guard++) {
        const res = await this.http.call(`/clubs/bookings/listing`, {
          "club.id": this.http.clubId,
          itemsPerPage: perPage,
          page,
          canceled: "true",
          confirmed: "true",
          getTotalItems: "true",
          "order[booking.startAt]": "asc",
          "startAt[after]": range.fromISO,
          "startAt[before]": range.toISO,
        });
        const batch = extractCollection(res);
        if (total === null) {
          const r = res as Record<string, unknown>;
          total = Number(r.totalItems ?? r["hydra:totalItems"] ?? batch.length);
        }
        all.push(...batch);
        if (!batch.length || all.length >= total) break;
        page += 1;
      }

      // CDC §13.3 : le filtre temporel du listing est peu fiable, on le
      // réapplique donc localement (ne jamais faire confiance à l'API seule).
      const fromMs = Date.parse(range.fromISO);
      const toMs = Date.parse(range.toISO);
      return all
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

  async getBooking(id: string): Promise<LegacyBookingDto> {
    return this.withLegacyErrorMapping(async () => {
      const raw = await this.http.call<Record<string, unknown>>(`/clubs/bookings/${id}`);
      return this.normalizeBooking(raw);
    });
  }

  private normalizeBooking(raw: Record<string, unknown>): LegacyBookingDto {
    const playgrounds = Array.isArray(raw.playgrounds) ? (raw.playgrounds as Record<string, unknown>[]) : [];
    return {
      id: str(raw.id),
      startAt: str(raw.startAt),
      endAt: str(raw.endAt),
      canceled: Boolean(raw.canceled),
      comment: typeof raw.comment === "string" ? raw.comment : null,
      playgroundIds: playgrounds.map((p) => str(p.id)),
      accessCodes: Array.isArray(raw.accessCodes) ? (raw.accessCodes as LegacyBookingDto["accessCodes"]) : [],
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
