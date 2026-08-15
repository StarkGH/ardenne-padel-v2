# Stratégie de test

CDC §66, §101. 177 tests automatisés (Lot 10, 2026-08-15), tous exécutés contre une vraie base PostgreSQL — jamais de mock du domaine (seuls les SDK externes, Stripe et Doinsport, sont remplacés par des doubles fidèles au contrat réel, `FakePaymentProvider`/`FakeLegacyProvider`).

## Pourquoi pas de vrais tests Playwright (navigateur)

Le CDC §66 nomme la suite "Tests E2E Playwright" en anticipant un frontend. **Aucun frontend n'existe dans ce projet** (Next.js jamais démarré — voir ADR-0017) : chaque scénario "E2E" ci-dessous est donc vérifié au niveau HTTP (`supertest` contre `createApp()`) ou au niveau service (appel direct des classes de service contre la vraie base), jamais via un navigateur piloté. C'est la même API que consommerait un vrai frontend Playwright — le jour où celui-ci existera, ces scénarios pourront être rejoués tels quels par-dessus une UI réelle, sans changer la logique métier vérifiée.

## Correspondance avec les scénarios du CDC §66

| # | Scénario | Statut | Test(s) |
|---|---|---|---|
| E2E-001 | Neuf → simple → créneau → inscription → FULL online → confirmation | ✅ | `bookings.http.integration.test.ts` |
| E2E-002 | Migré → double → 4 participants → FULL wallet | ⚠️ Partiel | 100% wallet couvert (`checkout.service.test.ts`), lien Legacy testé séparément — pas un seul scénario combiné avec 4 participants (FULL n'a pas de notion de "participants" au-delà de l'organisateur) |
| E2E-003 | SPLIT → frais affiché → 3 invitations → paiements | ✅ | `split-checkout.service.test.ts` |
| E2E-004 | SPLIT garanti carte → impayé → régularisation organisateur | ✅ | `split-checkout.service.test.ts` ("captures the remaining card guarantee at régularisation") |
| E2E-005 | SPLIT garanti wallet → holds créés → participants paient → holds libérés | ✅ | `split-checkout.service.test.ts` (libération proportionnelle puis totale) |
| E2E-006 | SPLIT garanti wallet → impayé → hold capturé | ⚠️ Partiel | `coverUnpaidSharesWithGuarantee` existe (`booking-share.service.ts`) mais son déclenchement automatique et la capture wallet spécifique à un impayé n'ont pas de test dédié |
| E2E-007 | Collision : créneau affiché dispo mais 422 au checkout | ✅ | `checkout.service.test.ts` ("voids the Stripe authorization and fails the booking on a Legacy collision") |
| E2E-008 | Paiement refusé | ✅ | `checkout.service.test.ts` ("fails the booking without creating a Legacy booking when the card is declined") |
| E2E-009 | Annulation autorisée + remboursement externe | ⚠️ Partiel | Annulation (`bookings.http.integration.test.ts`) et remboursement (`refund.service.test.ts`) testés isolément — non reliés automatiquement (`RefundService` pas encore déclenché par `cancelBooking`, gap documenté ADR-0017) |
| E2E-010 | Annulation autorisée + restitution wallet/holds | ⚠️ Partiel | Même limite : `WalletRefunded` testé isolément (`wallet.service.test.ts`), pas encore relié automatiquement à l'annulation |
| E2E-011 | Annulation hors délai | ✅ | `bookings.http.integration.test.ts` ("rejects cancellation past the client-facing cancellation deadline") — gap identifié en écrivant cette table, comblé dans la foulée |
| E2E-012 | Wallet total | ✅ | `checkout.service.test.ts` ("confirms with 100% wallet and never creates a Stripe transaction") |
| E2E-013 | Wallet partiel + paiement externe | ✅ | `checkout.service.test.ts` ("splits payment between wallet and card...") |
| E2E-014 | Achat pack 100€ → 100 crédits | ✅ | `credit-pack.service.test.ts` |
| E2E-015 | Achat pack avec bonus configuré | ✅ | `credit-pack.service.test.ts` ("credits both paid and bonus credits") |
| E2E-016 | Booking admin | ✅ | `bookings-admin.service.test.ts` |
| E2E-017 | Booking Legacy apparaît après sync | ❌ Non couvert | Aucune synchronisation Legacy→V2 n'a été construite à date (aucun lot) — voir ADR-0016 |
| E2E-018 | Timeout Legacy après POST → reconciliation/correlation | ⚠️ Partiel | `checkout.service.test.ts` ("goes to MANUAL_REVIEW without voiding... ambiguous Legacy failure") couvre la mise en attente humaine ; aucune réconciliation *automatique* n'existe (pas de job — dette assumée) |
| E2E-019 | Accès code V2 | ✅ | `access-grant.service.test.ts` |
| E2E-020 | Accès booking Legacy | ✅ | `access-grant.service.test.ts` ("imports Legacy codes instead of generating a V2 one") |
| E2E-021 | Kiosque → Payer ici → Terminal → confirmation | ❌ Non couvert | Terminal jamais câblé dans un parcours de réservation (ADR-0014) |
| E2E-022 | Kiosque → QR → reprise smartphone → paiement → confirmation tablette | ✅ | `kiosk-checkout-session.service.test.ts` |
| E2E-023 | QR expiré | ✅ | `kiosk-checkout-session.service.test.ts` ("rejects lookup of an expired PENDING session") |
| E2E-024 | Webhook Stripe reçu deux fois → un seul effet | ✅ | `checkout.service.test.ts` ("is idempotent when the webhook is delivered twice") + `concurrency.test.ts` (livraison réellement simultanée) |
| E2E-025 | Pack payé mais webhook retardé → état cohérent, crédit unique | ✅ | `credit-pack.service.test.ts` ("credits the wallet only once even if the completion is triggered twice") |

**Bilan : 17 pleinement couverts, 6 partiellement, 2 non couverts** (E2E-017 sync Legacy→V2 — jamais construite, portée d'un lot futur ; E2E-021 Terminal en parcours réel — nécessite un compte Stripe et un lecteur physique, ADR-0014).

## Tests de concurrence (CDC §67)

`apps/api/src/modules/payments/concurrency.test.ts` — chaque scénario déclenche deux requêtes réellement simultanées (`Promise.all`, jamais séquentielles) :

- double clic sur checkout FULL → un seul hold wallet, un seul paiement, une seule confirmation ;
- double clic sur checkout SPLIT → un seul jeu de parts créé ;
- deux paiements concurrents de la même part SPLIT → un seul débit ;
- deux annulations concurrentes de la même réservation → une seule transition CANCELED ;
- double livraison webhook simultanée → un seul effet.

**Un vrai bug de concurrence a été trouvé et corrigé en écrivant ces tests** : ni `checkout()` ni `cancelBooking()` ne réclamaient la réservation de façon atomique avant d'agir — deux requêtes concurrentes pouvaient toutes les deux créer un hold wallet, ou toutes les deux annuler côté Legacy. Corrigé par une transition d'état conditionnelle (`BookingsRepository.transitionStatus`, `WHERE status = X`) avant toute action externe, sur le même modèle que les gardes déjà en place pour les holds wallet et les achats de packs. Voir ADR-0018.

## Tests de résilience (CDC §68)

`apps/api/src/modules/payments/resilience.test.ts` — simulent une panne réelle (rejet de promesse, pas juste un statut d'échec) :

- timeout Stripe à l'autorisation → réservation reclaimable, aucun hold orphelin ;
- timeout Stripe à la capture après confirmation Legacy → `MANUAL_REVIEW`, jamais un retour silencieux à l'état initial ;
- fournisseur de notification indisponible → la réservation se confirme quand même ;
- provider d'accès indisponible → la réservation se confirme quand même, l'échec est tracé (`AccessGrant.status = FAILED`).

Les pannes Legacy (401/422/500/timeout) sont couvertes par `checkout.service.test.ts` existant depuis le Lot 4 : l'adaptateur ne distingue que "collision connue" (422) de "erreur ambiguë" (tout le reste, 401/500/timeout confondus) — les deux branches sont testées.

**"Worker redémarré" est sans objet** : aucun worker/job asynchrone n'existe encore dans le projet (pg-boss jamais introduit — dette assumée depuis les Lots 4/7/8/9).
