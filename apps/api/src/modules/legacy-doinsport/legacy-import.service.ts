import type { PrismaClient } from "@prisma/client";
import { logger } from "@ardenne/shared";
import type { LegacyDoinsportRepository } from "./legacy-doinsport.repository.js";
import { decideClientLink } from "./client-dedup.js";
import { normalizeEmail } from "../identity/identity.repository.js";
import type { LegacyBookingProvider } from "./types.js";

/**
 * Logique d'import Doinsport → V2 (CDC §7.5, §10.3), partagée entre le
 * script d'import initial/manuel (`scripts/import-legacy.ts`, ADR-0032) et
 * le scheduler récurrent (`legacy-sync-scheduler.ts`, ADR-0035) — même
 * comportement, seule la fréquence et la fenêtre d'appel diffèrent. Typée
 * sur l'interface `LegacyBookingProvider` plutôt que sur `LegacyDoinsportAdapter`
 * pour rester testable avec `FakeLegacyProvider`.
 */

export async function importClients(adapter: LegacyBookingProvider, prisma: PrismaClient) {
  const run = await prisma.legacySyncRun.create({ data: { kind: "CLIENTS" } });
  try {
    // `listClients()` fait déjà l'upsert brut de chaque fiche (Lot 2) —
    // cet appel suffit à peupler/rafraîchir `legacy_clients`.
    const clients = await adapter.listClients();
    logger.info({ event: "LegacyClientsFetched", count: clients.length }, "clients Doinsport récupérés et upsertés");

    // Passe de déduplication CDC §7.5, uniquement sur les clients jamais
    // encore traités — ne jamais reconsidérer un INVITED/MIGRATED/DISABLED/
    // MERGE_REQUIRED existant (déjà résolu ou déjà signalé à un admin).
    const candidates = await prisma.legacyClient.findMany({ where: { migrationStatus: "LEGACY_ONLY" } });
    let linked = 0;
    let flagged = 0;
    for (const candidate of candidates) {
      const normalizedEmail = candidate.email ? normalizeEmail(candidate.email) : null;
      const usersMatchingEmail = normalizedEmail ? await prisma.user.findMany({ where: { email: normalizedEmail } }) : [];
      const usersMatchingPhone = candidate.phone ? await prisma.user.findMany({ where: { phone: candidate.phone } }) : [];

      const decision = decideClientLink({
        legacyEmail: normalizedEmail,
        legacyPhone: candidate.phone,
        usersMatchingEmail: usersMatchingEmail.map((u) => ({ id: u.id, email: u.email })),
        usersMatchingPhone: usersMatchingPhone.map((u) => ({ id: u.id, email: u.email })),
      });
      if (decision.migrationStatus === "LEGACY_ONLY") continue;

      if (decision.migrationStatus === "MIGRATED") {
        // linkedUserId est unique en base : un compte déjà lié à un autre
        // client Legacy ne doit jamais être réassigné silencieusement.
        const alreadyLinked = await prisma.legacyClient.findUnique({ where: { linkedUserId: decision.linkedUserId } });
        if (alreadyLinked && alreadyLinked.id !== candidate.id) {
          await prisma.legacyClient.update({
            where: { id: candidate.id },
            data: {
              migrationStatus: "MERGE_REQUIRED",
              mergeNote: `E-mail correspond à un compte V2 déjà lié à un autre client Legacy (${alreadyLinked.externalId}).`,
            },
          });
          flagged += 1;
          continue;
        }
        await prisma.legacyClient.update({
          where: { id: candidate.id },
          data: { migrationStatus: "MIGRATED", linkedUserId: decision.linkedUserId },
        });
        linked += 1;
      } else {
        await prisma.legacyClient.update({
          where: { id: candidate.id },
          data: { migrationStatus: "MERGE_REQUIRED", mergeNote: decision.mergeNote },
        });
        flagged += 1;
      }
    }

    await prisma.legacySyncRun.update({
      where: { id: run.id },
      data: { status: "SUCCESS", finishedAt: new Date(), itemsSeen: clients.length, itemsChanged: linked + flagged },
    });
    logger.info({ event: "LegacyClientDedupDone", scanned: candidates.length, linked, flagged }, "déduplication clients terminée");
    return { fetched: clients.length, linked, flagged };
  } catch (err) {
    await prisma.legacySyncRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), errorSummary: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

export async function importBookings(
  adapter: LegacyBookingProvider,
  repo: LegacyDoinsportRepository,
  prisma: PrismaClient,
  fromISO: string,
  toISO: string,
) {
  const run = await prisma.legacySyncRun.create({ data: { kind: "BOOKINGS" } });
  let itemsSeen = 0;
  let itemsChanged = 0;
  let itemsFailed = 0;
  try {
    const summaries = await adapter.listBookings({ fromISO, toISO });
    itemsSeen = summaries.length;
    logger.info({ event: "LegacyBookingsListed", count: summaries.length, fromISO, toISO }, "réservations Doinsport listées");

    const mappings = await repo.listActiveCourtMappings();
    const courtIdByPlaygroundId = new Map(mappings.map((m) => [m.legacyPlaygroundId, m.court.id]));
    const knownClientExternalIds = new Set((await prisma.legacyClient.findMany({ select: { externalId: true } })).map((c) => c.externalId));

    for (const summary of summaries) {
      try {
        const full = await adapter.getBooking(summary.id);
        const resolvedLegacyClientId =
          full.bookingOwnerClientId && knownClientExternalIds.has(full.bookingOwnerClientId) ? full.bookingOwnerClientId : null;

        for (const playgroundId of full.playgroundIds) {
          const courtId = courtIdByPlaygroundId.get(playgroundId);
          if (!courtId) continue; // terrain hors périmètre V2 (autre sport/activité au même club)

          await prisma.legacyBooking.upsert({
            where: { externalId_courtId: { externalId: full.id, courtId } },
            create: {
              externalId: full.id,
              courtId,
              legacyClientId: resolvedLegacyClientId,
              startAt: new Date(full.startAt),
              endAt: new Date(full.endAt),
              canceled: full.canceled,
              comment: full.comment,
              lastSyncedAt: new Date(),
            },
            update: {
              legacyClientId: resolvedLegacyClientId,
              startAt: new Date(full.startAt),
              endAt: new Date(full.endAt),
              canceled: full.canceled,
              comment: full.comment,
              lastSyncedAt: new Date(),
            },
          });
          itemsChanged += 1;
        }
      } catch (err) {
        itemsFailed += 1;
        logger.error({ event: "LegacyBookingImportFailed", bookingId: summary.id, err }, "échec import d'une réservation Legacy");
      }
    }

    await prisma.legacySyncRun.update({
      where: { id: run.id },
      data: {
        status: itemsFailed > 0 ? "PARTIAL" : "SUCCESS",
        finishedAt: new Date(),
        itemsSeen,
        itemsChanged,
        errorSummary: itemsFailed > 0 ? `${itemsFailed} réservation(s) en échec — voir les logs` : null,
      },
    });
    return { fetched: itemsSeen, imported: itemsChanged, failed: itemsFailed };
  } catch (err) {
    await prisma.legacySyncRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), itemsSeen, itemsChanged, errorSummary: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
