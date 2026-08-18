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
docker compose -f docker-compose.staging.yml --env-file .env.staging run --rm api npm run prisma:migrate:deploy
```

Pas de `--workspace apps/api` ici : à l'intérieur du conteneur `api`, `WORKDIR` est déjà `/app/apps/api` (seul ce package a été copié dans l'image runtime, pas le monorepo entier) — ce n'est pas un contexte npm workspaces.

### 5. Premier compte SUPER_ADMIN

`apps/api/prisma/seed.ts` crée des comptes de développement (`DevPassword123!` en clair, données de démonstration) inappropriés dès qu'un vrai domaine est exposé. Utiliser plutôt le script dédié :

```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging exec api npm run provision:admin -- --email=admin@example.com --password='...' --firstName=... --lastName=...
```

Idempotent (upsert par e-mail) — rejouable sans risque pour changer le mot de passe d'un compte existant.

### 6. Vérification

- `curl https://<domaine>/api/v1/auth/me` → `401` (API up, TLS valide).
- Ouvrir `https://<domaine>/` → page d'accueil.
- `docker compose -f docker-compose.staging.yml logs -f reverse-proxy` → confirmer l'obtention automatique du certificat Let's Encrypt par Caddy (première requête HTTPS peut prendre quelques secondes).

## Mise à jour (déploiement d'une nouvelle version)

```bash
git pull
docker compose -f docker-compose.staging.yml --env-file .env.staging build
docker compose -f docker-compose.staging.yml --env-file .env.staging run --rm api npm run prisma:migrate:deploy
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d
```

## Serveur avec nginx déjà en place (pas le reverse-proxy Caddy fourni)

Le service `reverse-proxy` (Caddy) suppose un serveur dédié, libre sur les
ports 80/443. Sur un VPS mutualisé qui héberge déjà d'autres sites derrière
un nginx système (avec ses propres certificats Let's Encrypt), démarrer
Caddy en plus entrerait en conflit. Dans ce cas :

1. Ne pas démarrer le service `reverse-proxy` — cibler explicitement les
   autres : `docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build db api web`.
2. Publier `api`/`web` sur des ports hôte dédiés via un fichier
   `docker-compose.staging.override.yml` local (non commité) :
   ```yaml
   services:
     api:
       ports: ["127.0.0.1:3510:3000"]
     web:
       ports: ["127.0.0.1:3511:3001"]
   ```
   (adapter les ports pour éviter toute collision avec les autres apps du serveur).
3. Ajouter un `server{}` nginx pour le sous-domaine, `location /api/v1/` → `proxy_pass http://127.0.0.1:3510/api/v1/;`, `location /` → `proxy_pass http://127.0.0.1:3511;` (voir les vhosts existants du serveur pour le patron exact).
4. `sudo certbot --nginx -d <sous-domaine>` pour le certificat — édite le vhost en place, pas besoin de gérer Let's Encrypt manuellement.

## Restant (dette assumée, à combler avant un vrai pilote)

- **CI/CD** : aucun pipeline ne construit/déploie automatiquement ces images depuis `.github/workflows/ci.yml` (qui ne fait que lancer les tests) — déploiement manuel uniquement pour l'instant.
- **Sauvegardes automatiques** : toujours pas de cron `pg_dump` (voir `docs/backup-restore.md`), à mettre en place sur le serveur de staging avant tout volume réel.
- **Observabilité** : pas de collecte de logs centralisée ni de métriques au-delà de `docker compose logs` — `HealthIndicatorsService`/`AlertsService` restent internes au dashboard admin.
- **Images non élaguées** : `apps/api/Dockerfile` copie `node_modules` complet (dépendances de dev incluses) plutôt que de faire un `npm ci --omit=dev` séparé après le build — plus simple, correct, mais l'image est plus grosse que nécessaire.
- ~~Dockerfiles non vérifiés par un vrai `docker build`~~ — confirmé lors du premier déploiement réel (VPS, `v2.ardenne-padel.be`). Deux bugs trouvés et corrigés à cette occasion : `npm ci` du stage `deps` échouait sur le `postinstall` d'`apps/api` (`prisma generate`, fichiers `prisma/` pas encore copiés à ce stade — fix `--ignore-scripts`) et le conteneur `api` crashait au démarrage (`libssl.so.1.1` absent de `node:20-alpine` — fix `apk add openssl` dans le stage `base`).
