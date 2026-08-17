import "dotenv/config";
import { loadConfig } from "@ardenne/config";
import { PrismaClient } from "@prisma/client";
import { logger } from "@ardenne/shared";
import { LegacyDoinsportAdapter } from "../modules/legacy-doinsport/legacy-doinsport.adapter.js";
import { LegacyDoinsportRepository } from "../modules/legacy-doinsport/legacy-doinsport.repository.js";
import { decideClientLink } from "../modules/legacy-doinsport/client-dedup.js";
import { normalizeEmail } from "../modules/identity/identity.repository.js";

/**
 * Import initial Doinsport → V2 (ADR-0031) : fiches clients ("Shadow
 * Client") et réservations passées/futures, en lecture seule côté Doinsport
 * (aucun appel d'écriture). Idempotent — peut être rejoué sans dupliquer
 * (upsert sur `externalId`/`(externalId, courtId)`).
 *
 * Usage :
 *   npm run import:legacy --workspace apps/api -- --target=clients
 *   npm run import:legacy --workspace apps/api -- --target=bookings --from=2024-01-01 --to=2027-01-01
 *   npm run import:legacy --workspace apps/api -- --target=all
 *
 * Le job récurrent (scheduler) n'existe pas encore — ce script est conçu
 * pour être rejouable manuellement en attendant (voir ADR-0031, Restant).
 */

interface Args {
  target: "clients" | "bookings" | "all";
  fromISO: string;
  toISO: string;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z]+)=(.+)$/.exec(arg);
    if (match) flags.set(match[1]!, match[2]!);
  }
  const target = flags.get("target") ?? "all";
  if (!["clients", "bookings", "all"].includes(target)) {
    throw new Error(`--target invalide : "${target}" (attendu clients|bookings|all)`);
  }
  const now = Date.now();
  const defaultFrom = new Date(now - 2 * 365 * 24 * 3600_000).toISOString();
  const defaultTo = new Date(now + 365 * 24 * 3600_000).toISOString();
  return {
    target: target as Args["target"],
    fromISO: flags.get("from") ? new Date(flags.get("from")!).toISOString() : defaultFrom,
    toISO: flags.get("to") ? new Date(flags.get("to")!).toISOString() : defaultTo,
  };
}

async function importClients(adapter: LegacyDoinsportAdapter, prisma: PrismaClient) {
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

async function importBookings(adapter: LegacyDoinsportAdapter, repo: LegacyDoinsportRepository, prisma: PrismaClient, fromISO: string, toISO: string) {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const prisma = new PrismaClient();
  const repo = new LegacyDoinsportRepository(prisma);
  const adapter = new LegacyDoinsportAdapter(config, repo);

  console.log(`Import Legacy — cible: ${args.target}` + (args.target !== "clients" ? ` — fenêtre réservations: ${args.fromISO} → ${args.toISO}` : ""));

  try {
    if (args.target === "clients" || args.target === "all") {
      const result = await importClients(adapter, prisma);
      console.log(`Clients : ${result.fetched} récupérés, ${result.linked} liés automatiquement, ${result.flagged} à valider manuellement (MERGE_REQUIRED).`);
    }
    if (args.target === "bookings" || args.target === "all") {
      const result = await importBookings(adapter, repo, prisma, args.fromISO, args.toISO);
      console.log(`Réservations : ${result.fetched} récupérées, ${result.imported} lignes importées/mises à jour, ${result.failed} en échec.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Import Legacy en échec :", err);
  process.exitCode = 1;
});
