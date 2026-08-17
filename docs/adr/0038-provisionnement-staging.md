# ADR 0038 — Provisionnement de l'environnement de staging

## Statut
Accepté

## Date
2026-08-17

## Contexte

`docs/annexe-b-checklist.md` (2026-08-17) identifiait l'absence de tout environnement de staging comme le blocage bloquant formellement la sortie de la Phase 0 ("staging fonctionnel", CDC §50/`docs/migration.md`) — `docker-compose.yml` ne fournissait qu'une base Postgres locale, aucun Dockerfile, aucune configuration de déploiement n'existait.

## Un bug bloquant découvert avant même de commencer

Avant d'écrire le moindre Dockerfile, un test direct (`node dist/server.js` après `npm run build`) a révélé que **le build de production ne démarrait pas** :

```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for .../packages/config/src/index.ts
```

Les trois packages partagés (`@ardenne/shared`/`config`/`domain`) déclaraient `"main": "./src/index.ts"` — valable pour `tsx` (dev) qui transpile à la volée, mais Node exécutant du JS compilé (`node dist/server.js`) tente de charger ce `.ts` littéralement et plante. Ce bug existait depuis le Lot 0 et n'avait jamais été détecté car aucun lot précédent n'avait jamais exécuté `npm run build && node dist/server.js` de bout en bout — seul `tsx watch` (dev) et `vitest` (tests, même mécanisme de résolution que tsx) avaient jamais tourné.

## Décision

### `exports` conditionnel plutôt que de sacrifier le confort de dev

Basculer `main`/`types` vers `./dist/*` aurait cassé le confort actuel : éditer `packages/shared/src/errors.ts` n'aurait plus été reflété par `tsx watch` sans rebuild manuel du package. Solution retenue (pattern documenté par TypeScript lui-même pour ce cas de figure) — chaque `package.json` des trois packages partagés déclare :

```json
"exports": {
  ".": {
    "development": "./src/index.ts",
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

`apps/api` passe désormais `--conditions=development` à `tsx` (`dev`, `seed`, `import:legacy`) et à `vitest` (`resolve.conditions` dans `vitest.config.ts`) — résolution vers la source TS live, comportement de dev strictement inchangé, vérifié en relançant la suite complète (259 tests toujours verts) et un test manuel du serveur dev. En production (`node dist/server.js`, aucune condition passée), Node résout vers `./dist/*` — le build compilé, correct.

### Ordre de build corrigé côté racine

`npm run build --workspaces` (ancien script racine) ne garantit aucun ordre topologique — `apps/api` pouvait être construit avant que `packages/config/dist` existe, cassant la résolution de types pour tout `tsc` lancé sur un clone neuf. Nouveau script : `build:packages` (les trois packages, sans dépendance entre eux — vérifié) suivi de `apps/api`/`apps/web`. Vérifié par un build complet depuis zéro (`rm -rf **/dist apps/web/.next && npm run build`) suivi d'un `node dist/server.js` répondant `401` à une vraie requête HTTP.

### Dockerfiles multi-stage, node_modules non élagué

`apps/api/Dockerfile` et `apps/web/Dockerfile` (contexte = racine du monorepo, nécessaire pour installer `packages/*`) : stage `deps` (`npm ci`), stage `build` (compile), stage `runtime` minimal ne copiant que les `dist/`, jamais les sources TS. `apps/web` utilise `output: "standalone"` (nouveau dans `next.config.ts`) — trace uniquement les fichiers réellement utilisés à l'exécution, vérifié par un build réel (`.next/standalone/apps/web/server.js` présent). Choix assumé de ne pas élaguer `node_modules` (dépendances de dev incluses dans l'image API) : plus simple et correct plutôt que de risquer de casser `prisma migrate deploy` (qui a besoin du CLI `prisma`, une devDependency) en tentant un `npm ci --omit=dev` mal ciblé — image plus grosse que nécessaire, dette assumée.

### Reverse proxy Caddy plutôt que nginx/Certbot

TLS automatique (Let's Encrypt) sans configuration manuelle de certificats — approprié pour un simple staging à un seul domaine. `deploy/Caddyfile` route `/api/*` vers le conteneur `api` sans réécriture (toutes les routes vivent déjà sous `/api/v1/*`, CDC), tout le reste vers `web`.

### Migrations en étape de release séparée, jamais au démarrage du conteneur

`CMD ["node", "dist/server.js"]` ne lance jamais `prisma migrate deploy` automatiquement — évite une course si plusieurs instances démarrent en parallèle. Documenté comme étape manuelle explicite dans `docs/deployment.md`.

### `.gitignore` corrigé en cours de route (fuite de secret potentielle)

`.gitignore` n'excluait que `.env` et `.env*.local` — un fichier `.env.staging` (nom introduit par ce lot) n'aurait **pas** été ignoré, risque réel de commit accidentel de secrets de staging. Corrigé en `.env` + `.env.*` avec exception explicite `!.env.*.example`. Vérifié avec `git check-ignore`.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Basculer `main`/`types` directement vers `dist/` sans `exports` conditionnel | Aurait cassé le rechargement à chaud en dev — friction quotidienne pour un gain de production qui peut s'obtenir sans ce sacrifice |
| Kubernetes / orchestrateur complet | Disproportionné pour un simple environnement de staging à trafic pilote — Docker Compose + reverse proxy suffisent, cohérent avec CDC §4 ("microservices" explicitement exclu du périmètre) |
| nginx + Certbot manuel | Caddy obtient/renouvelle les certificats automatiquement sans configuration cron dédiée — moins de pièces mobiles pour un même résultat |
| Choisir un hébergeur/VPS précis et le provisionner | Décision opérationnelle (coût, région, relation contractuelle) qui appartient au club, pas quelque chose que le code peut trancher unilatéralement |

## Conséquences

**Positif :** bug de production bloquant trouvé et corrigé (aurait empêché tout déploiement réel, découvert avant qu'il ne cause un incident) ; build complet depuis zéro vérifié de bout en bout (packages → api → web, `node dist/server.js` répond réellement en HTTP) ; suite de tests inchangée (259 tests verts, 42 fichiers) ; artefacts de déploiement complets et documentés (Dockerfiles, compose, reverse proxy, runbook) prêts à être utilisés dès qu'un serveur est provisionné.

**Négatif / dette assumée :** **les Dockerfiles n'ont pas pu être vérifiés par un vrai `docker build`** — le démon Docker n'était pas démarrable dans l'environnement de développement utilisé pour ce lot (accès `sudo` non disponible pour le démarrer). Chaque chemin `COPY` a été vérifié manuellement présent après un build réel du monorepo hors conteneur, ce qui donne une confiance raisonnable mais pas une garantie — **à confirmer avec un `docker build` réel avant le premier déploiement**. Pas de CI/CD pour construire/pousser ces images automatiquement. Pas de script de provisionnement du premier compte admin en staging (procédure manuelle documentée). Aucun serveur n'est réellement provisionné — ce lot livre les artefacts, pas l'environnement lui-même.
