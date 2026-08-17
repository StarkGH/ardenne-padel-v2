# Déploiement — environnement de staging

CDC §61, §63. Complète `docs/operations.md` (secrets) et `docs/migration.md`
(Phase 0 exige "staging fonctionnel" avant toute Phase 1). Voir ADR-0038
pour les décisions et leur justification.

## Prérequis

- Un serveur (VPS ou équivalent) avec Docker + Docker Compose v2 installés, un domaine pointant dessus (DNS A/AAAA), les ports 80/443 ouverts.
- **Non fourni par ce lot** — le choix du fournisseur, l'achat du domaine et le provisionnement du serveur restent une décision opérationnelle du club, pas quelque chose que le code peut résoudre seul.

## Étapes

### 1. Cloner le dépôt sur le serveur

```bash
git clone <url-du-dépôt> ardenne-padel-v2 && cd ardenne-padel-v2
```

### 2. Préparer les secrets

```bash
cp .env.staging.example .env.staging
```

Éditer `.env.staging` : générer `SESSION_SECRET`/`POSTGRES_PASSWORD` réels (ex. `openssl rand -base64 32`), renseigner le domaine réel, les clés Stripe **test** (jamais live avant validation complète — voir Annexe B), les identifiants Doinsport. Ne jamais committer ce fichier — voir `.gitignore` (corrigé au passage : `.env.staging` n'était pas exclu avant ce lot, seul `.env` et `.env*.local` l'étaient).

### 3. Build et démarrage

```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging build
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d
```

### 4. Migrations (jamais automatique au démarrage du conteneur, voir ADR-0038)

```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging run --rm api npm run prisma:migrate:deploy --workspace apps/api
```

### 5. Premier compte SUPER_ADMIN

**Aucun script de seed adapté au staging n'existe** — `apps/api/prisma/seed.ts` crée des comptes de développement (`DevPassword123!` en clair, données de démonstration) inappropriés dès qu'un vrai domaine est exposé. Provisionner le premier compte manuellement (`npm run --workspace apps/api prisma:generate` puis une requête `INSERT` directe, ou un script dédié à écrire — voir Restant ci-dessous).

### 6. Vérification

- `curl https://<domaine>/api/v1/auth/me` → `401` (API up, TLS valide).
- Ouvrir `https://<domaine>/` → page d'accueil.
- `docker compose -f docker-compose.staging.yml logs -f reverse-proxy` → confirmer l'obtention automatique du certificat Let's Encrypt par Caddy (première requête HTTPS peut prendre quelques secondes).

## Mise à jour (déploiement d'une nouvelle version)

```bash
git pull
docker compose -f docker-compose.staging.yml --env-file .env.staging build
docker compose -f docker-compose.staging.yml --env-file .env.staging run --rm api npm run prisma:migrate:deploy --workspace apps/api
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d
```

## Restant (dette assumée, à combler avant un vrai pilote)

- **Provisionnement du premier compte admin** : pas de script dédié, procédure manuelle documentée ci-dessus seulement.
- **CI/CD** : aucun pipeline ne construit/déploie automatiquement ces images depuis `.github/workflows/ci.yml` (qui ne fait que lancer les tests) — déploiement manuel uniquement pour l'instant.
- **Sauvegardes automatiques** : toujours pas de cron `pg_dump` (voir `docs/backup-restore.md`), à mettre en place sur le serveur de staging avant tout volume réel.
- **Observabilité** : pas de collecte de logs centralisée ni de métriques au-delà de `docker compose logs` — `HealthIndicatorsService`/`AlertsService` restent internes au dashboard admin.
- **Images non élaguées** : `apps/api/Dockerfile` copie `node_modules` complet (dépendances de dev incluses) plutôt que de faire un `npm ci --omit=dev` séparé après le build — plus simple, correct, mais l'image est plus grosse que nécessaire.
- **Dockerfiles non vérifiés par un vrai `docker build`** : écrits et les chemins qu'ils copient ont été vérifiés manuellement présents après un build réel du monorepo (`apps/api/dist`, `packages/*/dist`, `apps/web/.next/standalone`), mais le démon Docker n'était pas démarrable dans l'environnement de développement utilisé pour ce lot (accès `sudo` non disponible) — **à confirmer avec un vrai `docker build` avant le premier déploiement réel**.
