import "dotenv/config";

// Garde-fou : les tests d'intégration ne doivent jamais tourner contre une
// base qui ressemble à de la production (CDC §62 — ne jamais mélanger les
// environnements).
const dbUrl = process.env.DATABASE_URL ?? "";
if (process.env.NODE_ENV === "production" || /prod/i.test(dbUrl)) {
  throw new Error("Refus de lancer les tests : DATABASE_URL ou NODE_ENV ressemble à de la production.");
}
