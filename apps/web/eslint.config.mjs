import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Ce projet récupère ses données via `fetch` directement dans des
      // `useEffect` (pas de bibliothèque de data-fetching — cohérent avec le
      // choix de dépendances minimales du reste du projet) : un `setState`
      // dans le corps de l'effet, une fois la promesse résolue, est le
      // schéma standard pour ce cas, pas un anti-pattern.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
