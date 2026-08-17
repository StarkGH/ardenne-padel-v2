# Ardenne Padel V2

[![CI](https://github.com/StarkGH/ardenne-padel-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/StarkGH/ardenne-padel-v2/actions/workflows/ci.yml)

Plateforme propriétaire destinée à remplacer progressivement Doinsport pour la gestion des réservations, paiements, wallet et accès du club Ardenne Padel.

**Statut : Lots 0 à 10 (backend) et les 12 lots frontend (client, SPLIT, wallet, profil, kiosque, les 25 écrans admin, écrans secondaires, changement d'e-mail, rapport de chiffre d'affaires, création de réservation admin, planning en grille) terminés — 218 tests verts, CI en place.** Reste : la migration par cohortes et le cutover Doinsport (voir [`PLAN_ACTION.md`](PLAN_ACTION.md) pour le détail lot par lot et [`docs/migration.md`](docs/migration.md) pour la suite). Aucun compte Stripe réel n'est encore configuré pour Ardenne Padel — les parcours de paiement se dégradent proprement (503) en attendant (sauf les paiements 100 % wallet, réellement fonctionnels).

## Documents de référence

| Document | Rôle |
|---|---|
| [`docs/CAHIER_DES_CHARGES_V1.1.md`](docs/CAHIER_DES_CHARGES_V1.1.md) | Spécification fonctionnelle et technique de référence (source de vérité produit) |
| [`docs/API-CATALOG.md`](docs/API-CATALOG.md) | Catalogue audité des API Doinsport exploitables |
| [`PLAN_ACTION.md`](PLAN_ACTION.md) | Plan d'action de développement, lot par lot, avec jalons et critères de sortie |
| [`docs/architecture.md`](docs/architecture.md) | Vue d'ensemble de l'architecture cible (monolithe modulaire) |
| [`docs/migration.md`](docs/migration.md) | Stratégie Dual Run et migration par cohortes |
| [`docs/tva.md`](docs/tva.md) | Taux de TVA confirmés par le comptable et implications pour le modèle de données (V-018) |
| [`docs/adr/`](docs/adr/) | Décisions d'architecture structurantes |

En cas d'ambiguïté entre le code et le CDC : **le CDC fait foi**. Toute décision structurante doit être documentée dans un ADR (voir `docs/adr/0000-template.md`).

## Code d'audit existant à réutiliser

Le repository `padel-service/` (dossier voisin) contient le code d'audit Doinsport déjà validé et **ne doit pas être jeté** :

- `doinsport.js`, `refresh-doin-token.js` — authentification club et rafraîchissement JWT
- `court-map.js` — mapping terrains/activités Doinsport (UUID réels des 4 terrains)
- `db.js`, `booking-db.js` — accès base legacy
- `sync.js`, `sync-all.js` — synchronisation
- `API-CATALOG.md` — catalogue d'endpoints audités

Ce code doit être encapsulé (tests de caractérisation puis portage) dans `apps/api/src/modules/legacy-doinsport/` — voir CDC §72 et Lot 2 du plan d'action.

## Structure du repository

```text
/apps
  /web              PWA React/Next.js mobile-first (client + kiosque)
  /api              Backend Node.js/TypeScript — monolithe modulaire
    /src/modules
      identity, users, social, courts, availability, pricing,
      bookings, payments, wallet, notifications, access,
      admin, legacy-doinsport, audit

/packages
  /domain           Types et règles métier partagées
  /shared           Utilitaires partagés (dates, argent, ids)
  /config           Configuration/feature flags typés

/docs
  /adr              Architecture Decision Records
  /api              Documentation API (OpenAPI généré/documenté)
  /operations       Runbooks (déploiement, rollback, incidents)
  /migration        Stratégie Dual Run et cohortes
  /testing          Stratégie de tests (unitaires, intégration, E2E, chaos)

/openapi            openapi.yaml
/scripts            Scripts de maintenance, sync, seed
```

## Démarrage

Statut Lot 1 : module `identity` fonctionnel de bout en bout (inscription, vérification e-mail, connexion, session, déconnexion, déconnexion globale, reset mot de passe), avec RBAC de base. Testé manuellement et via la suite automatisée (18 tests, unitaires + intégration réelle sur PostgreSQL).

### 1. Installation

```bash
npm install
```

### 2. Base de données

Deux options :

- **Recommandé (référence du repo) :** `npm run db:up` démarre PostgreSQL via `docker-compose.yml` (port 5432).
- **Alternative (PostgreSQL déjà installé nativement, ex. WSL) :** créer un rôle et une base dédiés, puis adapter `DATABASE_URL` en conséquence (port différent possible — voir `docs/operations.md` pour un exemple vécu avec Postgres natif WSL sur le port 5433).

### 3. Configuration

```bash
cp .env.example apps/api/.env
```

Éditer `apps/api/.env` : `DATABASE_URL`, `SESSION_SECRET` (une vraie valeur aléatoire, même en dev), `PUBLIC_BASE_URL`, `API_BASE_URL`. Les flags Legacy/Stripe/Wallet peuvent rester à leurs valeurs par défaut (désactivés) tant que les lots correspondants ne sont pas développés.

### 4. Migrations + génération du client Prisma

```bash
npm run prisma:migrate
```

### 5. Seed de développement (optionnel)

```bash
npm run seed
```

Crée deux comptes de dev (mot de passe `DevPassword123!`) : `admin@dev.ardenne-padel.local` (ADMIN) et `joueur1@dev.ardenne-padel.local` (CUSTOMER).

### 6. Lancer l'API

```bash
npm run dev:api
```

API disponible sur `http://localhost:3000/api/v1`. Vérifier avec `GET /api/v1/health`.

Au Lot 1, il n'y a pas encore de vrai provider e-mail (arrive au Lot 8) : les liens de vérification/reset s'affichent dans la console du serveur (`[dev-email] ...`), jamais dans les logs structurés de production.

### 7. Lancer le frontend

```bash
cp apps/web/.env.example apps/web/.env.local   # NEXT_PUBLIC_API_BASE_URL
npm run dev --workspace apps/web
```

PWA disponible sur `http://localhost:3001`. Nécessite l'API déjà lancée (étape 6) — `PUBLIC_BASE_URL` côté API doit correspondre à cette URL pour que CORS autorise le navigateur (`CORS_ALLOWED_ORIGINS`, par défaut = `PUBLIC_BASE_URL`).

### 8. Tests

```bash
npm test              # tous les workspaces
npm run build          # compilation TypeScript stricte (type-check complet)
```

Les tests d'intégration du module identity tournent contre une vraie base PostgreSQL (celle de `DATABASE_URL`) — jamais de mock du domaine.

### 9. Feature flags

Voir `.env.example` : chaque flag est documenté par domaine (Legacy/Dual Run, Stripe, Split, Wallet, Access). Tous démarrent désactivés par défaut — un module s'active explicitement quand son lot est prêt.

### 9. Ne jamais toucher accidentellement à la production Doinsport

Tant que le module `legacy-doinsport` n'existe pas (Lot 2), ce point n'est pas encore actif. Dès son introduction : toujours garder `LEGACY_WRITE_ENABLED=false` en local/staging tant que les créneaux de test ne sont pas explicitement sécurisés (voir CDC §94).

## Principes non négociables (rappel CDC)

- Aucune donnée carte stockée (PAN/CVC) — tout passe par Stripe Elements/Terminal.
- Aucun float pour les montants — centimes entiers uniquement.
- Le frontend n'est jamais source de vérité métier ou financière.
- Toute écriture financière est idempotente (idempotency key).
- Le monolithe modulaire est l'architecture cible — pas de microservices au MVP.
- Doinsport reste isolé derrière `LegacyDoinsportAdapter` ; jamais d'ID Legacy comme clé primaire du domaine V2.
