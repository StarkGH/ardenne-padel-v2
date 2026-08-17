import "dotenv/config";
import { loadConfig } from "@ardenne/config";
import { PrismaClient } from "@prisma/client";
import { LegacyDoinsportAdapter } from "../modules/legacy-doinsport/legacy-doinsport.adapter.js";
import { LegacyDoinsportRepository } from "../modules/legacy-doinsport/legacy-doinsport.repository.js";
import { importClients, importBookings } from "../modules/legacy-doinsport/legacy-import.service.js";

/**
 * Import initial/manuel Doinsport → V2 (ADR-0031) : fiches clients ("Shadow
 * Client") et réservations passées/futures, en lecture seule côté Doinsport
 * (aucun appel d'écriture). Idempotent — peut être rejoué sans dupliquer
 * (upsert sur `externalId`/`(externalId, courtId)`).
 *
 * Usage :
 *   npm run import:legacy --workspace apps/api -- --target=clients
 *   npm run import:legacy --workspace apps/api -- --target=bookings --from=2024-01-01 --to=2027-01-01
 *   npm run import:legacy --workspace apps/api -- --target=all
 *
 * Le job récurrent (`legacy-sync-scheduler.ts`, ADR-0035) fait tourner la
 * même logique (`legacy-import.service.ts`) en continu — ce script reste
 * utile pour un import ponctuel hors fenêtre (ex. rattraper un historique
 * antérieur à ce que couvre la réconciliation) ou en environnement où le
 * scheduler est désactivé (`LEGACY_SYNC_ENABLED=false`).
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
