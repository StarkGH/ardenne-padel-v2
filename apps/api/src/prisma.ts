import { PrismaClient } from "@prisma/client";

/**
 * Instance unique de PrismaClient partagée par toute l'application. Les
 * transactions multi-tables (holds, shares, packs — lots futurs) passeront
 * par `prisma.$transaction`, avec `$queryRaw` pour les verrous explicites
 * (SELECT ... FOR UPDATE) quand nécessaire (voir ADR-0001).
 */
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
