import { defineConfig } from "vitest/config";

export default defineConfig({
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
