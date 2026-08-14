import type { PrismaClient } from "@prisma/client";
/**
 * Nettoyage complet inter-tests, dans l'ordre imposé par les contraintes de
 * clé étrangère (CDC §46 : jamais de cascade delete sur les tables
 * financières en production — donc l'ordre doit être explicite ici plutôt
 * que de compter sur `onDelete: Cascade`). Utilisé par tous les fichiers de
 * test d'intégration pour éviter les interférences entre fichiers (voir
 * `fileParallelism: false` dans vitest.config.ts).
 */
export declare function resetIntegrationTestData(prisma: PrismaClient): Promise<void>;
