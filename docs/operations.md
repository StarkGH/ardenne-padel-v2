# Opérations — Ardenne Padel V2

_Document à compléter au fil des lots (CDC §103 : déploiement, rollback, rotation secrets, sync Doinsport, replay jobs, incidents, sauvegarde, restauration)._

## ⚠️ À faire avant tout environnement partagé (staging/production)

- **Mot de passe PostgreSQL local `ardenne` à changer.** Le rôle `ardenne` a été créé en environnement de développement local (WSL, base native, port 5433) avec le mot de passe trivial `ardenne` (voir `apps/api/.env`, non commité). Ce mot de passe **ne doit jamais être réutilisé** au-delà du poste de développement local. Avant staging/production : générer un secret fort dédié par environnement (CDC §59.3 — clés différentes test/prod, secrets exclusivement via environnement/secret store).
- Le rôle `ardenne` a également reçu le droit `CREATEDB` (requis par `prisma migrate dev` pour sa "shadow database"). Ce droit est utile en local mais à reconsidérer pour un rôle applicatif en production (principe de moindre privilège) — le rôle de prod n'a pas besoin de `CREATEDB`, seulement des droits DML/DDL sur son propre schéma applicatif.
- `SESSION_SECRET` dans `.env` est actuellement une valeur de test (`dev-only-secret-do-not-use-in-prod`) — à régénérer avant tout déploiement.

## Environnement de développement local — particularité constatée

Sur ce poste, PostgreSQL tourne **nativement dans WSL** (pas via `docker-compose.yml`) sur le **port 5433** (et non 5432, occupé/configuré différemment par l'installation `postgresql-14` existante). Docker Desktop a présenté un bug bloquant (sous-système "Inference"/Docker AI, socket cassé sous `%LOCALAPPDATA%\Docker\run\dockerInference`) qui a nécessité de basculer sur Postgres natif pour valider le Lot 1. À réévaluer si Docker Desktop est réparé (redémarrage Windows généralement nécessaire pour libérer le handle bloqué) — le `docker-compose.yml` du repo reste la référence pour un environnement conteneurisé standard.

Authentification locale Postgres (`pg_hba.conf`) : les connexions **TCP vers `127.0.0.1`/`::1`** sont en `trust` (aucun mot de passe vérifié), alors que le socket Unix local exige `md5` pour le rôle `postgres`. C'est pourquoi les commandes d'administration locales utilisent `psql -h 127.0.0.1 -p 5433 -U postgres ...` plutôt que `sudo -u postgres psql`.

## Base de données de développement et de test partagée (constaté au Lot 5)

`DATABASE_URL` pointe vers la **même** base pour `npm run dev` et `npm test` sur ce poste — il n'existe pas de base de test isolée. Conséquence observée : lancer la suite de tests peut laisser des données de test dans la base de développement (ex. `credit_packs` créés par un test puis nettoyés au `beforeEach` suivant, qui peut supprimer des packs seedés pour le dev si les deux tournent en alternance). Sans gravité fonctionnelle (les tests nettoient après eux via `resetIntegrationTestData`), mais peut surprendre en observant l'état de la base après une session de tests. À corriger avant que l'équipe grandisse : une base Postgres dédiée aux tests (ex. `ardenne_padel_v2_test`), sélectionnée automatiquement quand `NODE_ENV=test`.
