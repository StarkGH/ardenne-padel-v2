import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "@ardenne/config";
import { AccessGrantRepository } from "../modules/access/access-grant.repository.js";
import { AccessGrantService } from "../modules/access/access-grant.service.js";
import { LocalAccessProvider } from "../modules/access/local-access-provider.js";

/** Instance réelle (contre la vraie base) pour les tests de services qui n'exercent pas eux-mêmes l'automatisme d'accès. */
export function buildTestAccessGrantService(prisma: PrismaClient, config: AppConfig): AccessGrantService {
  return new AccessGrantService(new AccessGrantRepository(prisma), new LocalAccessProvider(), config);
}
