import { config as loadEnv } from "dotenv";

// .env d'abord (Stripe/Doinsport/etc., partagés avec le dev), puis .env.test
// en override — seule DATABASE_URL y diffère. Sans ça, les tests
// d'intégration (nombreux `deleteMany()` non scopés dans les `beforeEach`)
// tournaient contre la même base Postgres que `npm run dev`, effaçant à
// chaque exécution les données réellement importées de Doinsport (1090
// clients, 4347 réservations) — vécu à plusieurs reprises pendant le
// développement de ce lot.
loadEnv();
loadEnv({ path: ".env.test", override: true });

// Garde-fou : les tests d'intégration ne doivent jamais tourner contre une
// base qui ressemble à de la production (CDC §62 — ne jamais mélanger les
// environnements).
const dbUrl = process.env.DATABASE_URL ?? "";
if (process.env.NODE_ENV === "production" || /prod/i.test(dbUrl)) {
  throw new Error("Refus de lancer les tests : DATABASE_URL ou NODE_ENV ressemble à de la production.");
}

// Garde-fou complémentaire : refuse explicitement de tourner contre la base
// de dev (identifiable par son nom, sans suffixe _test) plutôt que de
// supposer que .env.test a bien été chargé.
if (dbUrl && !/_test(\?|$)/.test(dbUrl)) {
  throw new Error(
    `Refus de lancer les tests : DATABASE_URL ne pointe pas vers une base de test (${dbUrl}). Vérifiez apps/api/.env.test.`,
  );
}
