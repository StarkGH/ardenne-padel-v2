# Architecture cible — Ardenne Padel V2

Référence normative : `CAHIER_DES_CHARGES_V1.1.md`, sections 6, 7–36, 42–48, 71, 97–98.

## Vue d'ensemble

```text
PWA (client + kiosque)  ─┐
Back-office              ├──▶  API V2 (monolithe modulaire, /api/v1)  ──▶ PostgreSQL
Apps natives (futur)    ─┘            │
                                       ├──▶ Jobs durables (queue sur PostgreSQL)
                                       ├──▶ Stripe (Payments + Terminal)
                                       ├──▶ Provider notifications (email)
                                       ├──▶ Access / Automation Adapter
                                       └──▶ Doinsport Adapter (Legacy, Dual Run)
```

## Modules du monolithe (frontières explicites, un seul déploiement)

`identity · users · social/participants · courts · availability · pricing · bookings · payments · wallet · notifications · access · admin · legacy-doinsport · audit`

Chaque module expose un service/interface clair. Le domaine (`Booking`, `Wallet`, `Split`) ne connaît jamais le SDK Stripe ni les structures Doinsport — ces intégrations sont de l'infrastructure, accédée via interfaces :

- `PaymentProvider` → `StripePaymentProvider`
- `LegacyBookingProvider` → `LegacyDoinsportAdapter`
- `NotificationProvider`
- `AccessProvider`

## Deux garde-fous structurants

1. **Aucune dépendance métier directe à Doinsport.** Les IDs Legacy sont des références externes (`legacy_*_mapping`), jamais des clés primaires du domaine.
2. **Aucun stockage de données carte.** La saisie carte passe exclusivement par les composants sécurisés Stripe.

## Dual Run (période de cohabitation, voir docs/migration.md)

Pendant `LEGACY_MODE=dual_run` :

- les règles V2 déterminent ce qui est commercialisable ;
- Doinsport reste l'arbitre anti-collision final (le `POST /clubs/bookings` tranche) ;
- toute réservation V2 est répliquée dans Doinsport ;
- les paiements V2 sont indépendants et gérés uniquement par V2.

Après cutover : PostgreSQL devient seul arbitre anti-collision via contrainte transactionnelle sur `(court_id, time_range)`.

## Stack de référence

TypeScript (backend + frontend), Next.js PWA mobile-first, Node.js backend, PostgreSQL avec migrations versionnées, API REST `/api/v1` documentée OpenAPI, tests unitaires/intégration/E2E Playwright, déploiement conteneurisé, secrets exclusivement via environnement/secret store.

Ajustable si le repository impose déjà un framework cohérent, mais **les frontières fonctionnelles ci-dessus doivent être conservées** (CDC §6.1).
