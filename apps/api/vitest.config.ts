import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Résout @ardenne/* vers leur source TS live (comme `tsx --conditions=development`
    // en dev) plutôt que vers dist/ — sinon éditer un package partagé n'aurait
    // aucun effet sur les tests tant que `npm run build` n'a pas été rejoué.
    conditions: ["development"],
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // Les tests d'intégration partagent une seule base PostgreSQL réelle
    // (pas de mock du domaine). Plusieurs fichiers de test font des
    // deleteMany() non scopés (isolation entre cas de test) : les exécuter
    // en parallèle provoquerait des interférences entre fichiers. À
    // reconsidérer si la suite grossit au point de rendre ça trop lent —
    // la vraie solution serait alors un schéma Postgres dédié par worker.
    fileParallelism: false,
  },
});
