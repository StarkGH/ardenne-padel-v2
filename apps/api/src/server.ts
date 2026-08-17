import "dotenv/config";
import { loadConfig } from "@ardenne/config";
import { logger } from "@ardenne/shared";
import { prisma } from "./prisma.js";
import { createApp } from "./app.js";
import { LegacyDoinsportAdapter } from "./modules/legacy-doinsport/legacy-doinsport.adapter.js";
import { LegacyDoinsportRepository } from "./modules/legacy-doinsport/legacy-doinsport.repository.js";
import { LegacySyncScheduler } from "./modules/legacy-doinsport/legacy-sync-scheduler.js";

const config = loadConfig();
const app = createApp({ prisma, config });

const server = app.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT, env: config.NODE_ENV }, "Ardenne Padel V2 API démarrée");
});

// Scheduler démarré ici plutôt que dans app.ts (partagé avec le harnais de
// test via supertest) — les tests d'intégration ne doivent jamais déclencher
// d'appel réseau réel vers Doinsport en arrière-plan.
const legacyRepo = new LegacyDoinsportRepository(prisma);
const legacySyncScheduler = new LegacySyncScheduler(config, prisma, new LegacyDoinsportAdapter(config, legacyRepo), legacyRepo);
legacySyncScheduler.start();

async function shutdown(signal: string) {
  logger.info({ signal }, "arrêt en cours");
  legacySyncScheduler.stop();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
