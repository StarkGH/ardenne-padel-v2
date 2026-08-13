# ADR 0001 — Architecture monolithe modulaire et stack technique

## Statut
Accepté

## Date
2026-08-13

## Contexte

Le CDC (§2.3, §6.1, §71) impose un **monolithe modulaire** comme architecture cible initiale — pas de microservices — avec des frontières métier explicites entre 14 modules (`identity, users, social, courts, availability, pricing, bookings, payments, wallet, notifications, access, admin, legacy-doinsport, audit`), chacun exposant des services/interfaces clairs mais déployés dans une seule application backend.

Le CDC propose une stack de référence (§6.1) : TypeScript backend + frontend, Next.js PWA mobile-first, Node.js backend avec « framework structuré », PostgreSQL avec migrations versionnées, API REST `/api/v1` documentée OpenAPI, tests unitaires/intégration/E2E Playwright, déploiement conteneurisé — tout en autorisant un ajustement si le repository existant impose déjà un framework cohérent, à condition de préserver les frontières fonctionnelles.

Élément de contexte propre à Ardenne Padel : le repository d'audit `padel-service/` (voisin de ce repo) est **déjà** TypeScript + Express + Vitest + Playwright + Luxon (dates) + npm scripts, sans monorepo tooling additionnel (pas de Turborepo/Nx). C'est le seul signal réel de préférence d'outillage disponible à ce jour ; il n'a pas la même finalité (outils de sync/export, pas le produit V2) mais réduit la friction d'onboarding et la dette d'apprentissage si on reste dans la même famille d'outils.

Deux garde-fous du CDC pèsent directement sur ce choix :
- **Intégrité financière** (§80, §46-47) : montants en centimes entiers, ledger wallet append-only, verrouillage transactionnel sur les écritures multi-tables (holds, shares, packs). Le choix d'accès aux données doit permettre un contrôle fin des transactions et des verrous (`SELECT ... FOR UPDATE` ou équivalent), pas seulement un ORM haut niveau qui les masque.
- **Réduction du risque opérationnel avant enrichissement** (§2.1, §112) : privilégier l'outil le plus simple, le plus testable et le plus réversible à besoin égal.

## Décision

### 1. Monolithe modulaire — structure

Une seule application backend déployable, avec un dossier par module sous `apps/api/src/modules/*` (déjà scaffoldé au Lot 0). Chaque module expose :
- une couche `routes` (HTTP) ;
- une couche `service` (règles métier, aucune dépendance à Express ni au SDK Stripe) ;
- une couche `repository` (accès données du module) ;
- ses propres tests unitaires/intégration colocalisés.

Les intégrations externes restent des adaptateurs derrière interface, jamais appelés directement par le domaine : `PaymentProvider` → `StripePaymentProvider`, `LegacyBookingProvider` → `LegacyDoinsportAdapter`, `NotificationProvider`, `AccessProvider` (CDC §98). Aucun module métier n'importe le SDK Stripe ni un client HTTP Doinsport directement.

### 2. Backend — Node.js + TypeScript + Express (pas NestJS)

**Express**, en mode strict (TypeScript strict, ESLint, structure imposée manuellement par convention de dossiers ci-dessus), plutôt que NestJS.

Justification via la règle de décision du CDC §112 (à risque financier égal, choisir ce qui réduit la complexité opérationnelle et est le plus réversible) :
- Express est déjà le choix éprouvé dans l'écosystème Ardenne Padel (`padel-service`) — zéro courbe d'apprentissage supplémentaire pour l'équipe actuelle.
- NestJS apporte de la structure "gratuite" (modules, DI) mais ajoute une couche de décorateurs/réflexion et un modèle mental supplémentaire, pour un bénéfice marginal ici : le CDC impose déjà explicitement les frontières de module et les interfaces, donc la discipline attendue peut être obtenue par convention plutôt que par framework.
- Migration vers NestJS (ou un autre framework structuré) reste possible plus tard sans réécrire le domaine, tant que la séparation route/service/repository est respectée dès le départ — décision réversible, donc à faible risque.

### 3. Accès aux données — PostgreSQL + Prisma

**PostgreSQL** (imposé par le CDC — nécessaire pour les contraintes transactionnelles anti-collision après cutover, §10.4, §46) avec **Prisma** comme ORM/outil de migration.

- Migrations versionnées avec historique lisible (`prisma migrate`).
- Transactions multi-tables via `prisma.$transaction`, avec passage en SQL brut (`$queryRaw`/`$executeRaw`) pour les verrous explicites (`SELECT ... FOR UPDATE`) requis sur `wallet_holds`, `booking_shares`, `credit_pack_purchases` (CDC §47).
- Alternative écartée : Drizzle ORM (plus proche du SQL, séduisant pour du code financier) — écarté pour l'instant car moins mature en écosystème/documentation que Prisma pour une équipe qui démarre le projet ; à reconsidérer si Prisma s'avère limitant sur les requêtes de ledger complexes (point de vigilance, pas un verrou définitif).

### 4. File de jobs durable — pg-boss

**pg-boss** (queue de jobs adossée à PostgreSQL, pas d'infra distribuée séparée), conformément à CDC §6.2 : « une queue durable adossée à PostgreSQL est acceptable pour le MVP ». Couvre invitations, rappels, sync Doinsport, réconciliation, provisioning accès, notifications, retries — tous rejouables et idempotents.

### 5. Frontend — Next.js (App Router) + TypeScript, PWA mobile-first

Conforme au CDC §6.1 et §53. TanStack Query pour l'état serveur (cache disponibilités/wallet), pas de librairie d'état global lourde au MVP — cohérent avec le principe API-first (§2.4) : le frontend ne porte aucune logique métier critique.

### 6. Tests

**Vitest** pour unitaire/intégration, **Playwright** pour E2E (CDC §66) — les deux déjà utilisés dans `padel-service`, donc outillage familier et zéro nouvelle dépendance à évaluer.

### 7. Monorepo

**npm workspaces** simple (`apps/*`, `packages/*`), sans Turborepo/Nx pour l'instant — cohérent avec le principe « éviter l'infrastructure disproportionnée » (§6.2) et la taille actuelle de l'équipe. À réévaluer seulement si les temps de build deviennent un problème réel et mesuré.

### 8. Hors scope de cet ADR

Le choix d'hébergement/plateforme de déploiement production n'est **pas** tranché ici — il dépend de contraintes (budget, hébergeur déjà utilisé pour `www.ardenne-padel.be`, etc.) non disponibles à ce stade. À documenter séparément dans `docs/operations.md` avant le Lot 10 (pilot hardening).

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| NestJS | Structure imposée par décorateurs/DI redondante avec les frontières déjà explicites du CDC ; coût d'apprentissage non justifié à ce stade (réversible plus tard) |
| Fastify | Performance supérieure à Express mais écosystème/habitudes moins alignées avec `padel-service` ; gain non déterminant au volume du club |
| Drizzle ORM | Plus proche SQL, séduisant pour le ledger financier, mais écosystème moins mature ; retenu comme option de repli si Prisma limite sur des requêtes complexes |
| Turborepo/Nx | Complexité de build/cache non justifiée pour 2 apps + 3 packages ; CDC §6.2 invite à éviter l'infrastructure disproportionnée |
| SQLite (comme `padel-service`) | Incompatible avec les exigences de verrouillage transactionnel anti-double-réservation après cutover (§10.4) et le volume d'écritures concurrentes attendu (holds, shares, webhooks) |
| Microservices | Explicitement exclu par le CDC (§2.3, §4) tant qu'un besoin n'est pas démontré |

## Conséquences

**Positif :**
- Démarrage rapide du Lot 1, aucune nouvelle technologie majeure à apprendre par rapport à l'existant.
- Transactions et verrous financiers restent sous contrôle explicite (Prisma + SQL brut ciblé), pas masqués par un ORM trop haut niveau.
- Réversibilité conservée sur les points à risque (framework backend, ORM) grâce à la séparation stricte domaine/infrastructure imposée dès le Lot 1.

**Négatif / dette assumée :**
- La discipline modulaire (route/service/repository, pas d'import croisé entre modules) repose sur la convention et la revue de code, pas sur un compilateur/DI qui l'empêcherait structurellement comme le ferait NestJS — à surveiller particulièrement à partir du Lot 6 (SPLIT) où les modules `bookings`, `payments`, `wallet` interagissent fortement.
- Si Prisma s'avère trop limitant sur les requêtes de ledger/holds à fort volume, une migration partielle vers Drizzle sur le module `wallet` uniquement est envisageable sans tout réécrire — mais représente un coût non nul à anticiper.
- Le choix d'hébergement production reste ouvert et devra être tranché avant le Lot 10 pour ne pas bloquer le pilote.

**Impact sur le plan d'action :** aucun changement de séquence des lots (`PLAN_ACTION.md`) ; cette décision cadre uniquement *comment* le Lot 1 est construit, pas son contenu fonctionnel.
