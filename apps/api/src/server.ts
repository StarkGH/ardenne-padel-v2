import "dotenv/config";
import { loadConfig } from "@ardenne/config";
import { logger } from "@ardenne/shared";
import { prisma } from "./prisma.js";
import { createApp } from "./app.js";

const config = loadConfig();
const app = createApp({ prisma, config });

const server = app.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT, env: config.NODE_ENV }, "Ardenne Padel V2 API démarrée");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "arrêt en cours");
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
