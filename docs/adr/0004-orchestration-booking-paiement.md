# ADR 0004 — Orchestration Booking / Paiement / Legacy

## Statut
Accepté (paiement simulé — le vrai Stripe arrive au Lot 4 sans changer cette structure)

## Date
2026-08-14

## Contexte

Le CDC §27 exige que la création d'une réservation ne laisse jamais un paiement orphelin, un terrain réservé sans garantie, ou une réservation confirmée sans que Doinsport l'ait acceptée pendant le Dual Run. Le Lot 3 doit dérouler cette orchestration de bout en bout, mais le module `payments` (Stripe) n'existe pas encore (Lot 4) : il fallait décider comment avancer sans ni bloquer le Lot 3, ni halluciner un vrai paiement.

## Décision

### 1. `BookingsService.createBooking` suit la séquence CDC §27.1

`DRAFT → CHECKOUT_PENDING → (Legacy si activé) → PAYMENT_PENDING → CONFIRMED`, avec la machine à états (`booking-state-machine.ts`) qui interdit toute transition non prévue (§17). Une erreur à n'importe quelle étape produit soit `FAILED` (collision Legacy avérée — jamais confirmé), soit `MANUAL_REVIEW` (échec inattendu — jamais d'hypothèse silencieuse, CDC §111), jamais un état ambigu.

### 2. `MockAlwaysSucceedsPaymentGateway` comme substitut temporaire explicite

Un fichier dédié, commenté sans ambiguïté ("à supprimer au Lot 4"), simule un paiement toujours réussi. Il implémente une interface minimale (`PaymentGateway`) injectée dans `BookingsService` au même endroit où `StripePaymentProvider` viendra se brancher au Lot 4 — aucun changement structurel attendu, seulement un remplacement d'implémentation.

### 3. Écriture Legacy strictement gardée par `LEGACY_WRITE_ENABLED` et le lien Shadow Client

Si `LEGACY_WRITE_ENABLED=false` (défaut dev/test) : aucune tentative Doinsport, aucune ligne `legacy_booking_mappings` créée (`booking.legacyBookingMapping` reste `null` plutôt qu'un statut `NOT_REQUIRED` artificiel). Si activé : la création Legacy exige un `LegacyClient` lié à l'organisateur (`linked_user_id`) — en son absence, la réservation part en `MANUAL_REVIEW` avec une raison explicite plutôt que d'inventer un `clientId` Legacy. C'est un gap connu et documenté : la migration complète des comptes (CDC §7.3, invitation Shadow Client) n'est pas encore implémentée.

### 4. Comparaison de prix V2/Legacy au moment de la création, pas à chaque devis

Le prix Legacy (`resolveLegacyPrice`) n'est appelé que lorsqu'une création Legacy réelle a lieu — pas à chaque `GET /pricing/quote` (CDC §84, éviter les appels superflus). L'écart au-delà de `LEGACY_PRICE_MISMATCH_TOLERANCE_CENTS` déclenche un log `PriceMismatch`, jamais une correction silencieuse du montant facturé (CDC §11.3) : **le prix facturé reste toujours celui de V2**.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Attendre le Lot 4 pour livrer un Lot 3 "complet" avec vrai paiement | Le CDC prévoit explicitement un Lot 3 avec paiement simulé (§91) ; retarder aurait bloqué la validation de l'orchestration Legacy/state machine, qui est le vrai risque du lot |
| Fabriquer un `legacyClientId` par défaut quand aucun lien n'existe | Contraire à CDC §111 (pas d'hypothèse silencieuse) ; créerait une réservation Doinsport attribuée au mauvais client |
| Comparer les prix V2/Legacy à chaque `GET /pricing/quote` | Coût réseau/latence inutile sur un endpoint consulté fréquemment ; le seul moment où le prix Legacy est de toute façon nécessaire est la création réelle |

## Conséquences

**Positif :** l'orchestration complète (y compris les branches d'échec) est testée avec un faux `LegacyBookingProvider` respectant le contrat réel de l'interface — le remplacement par le vrai adapter ou par Stripe au Lot 4 ne change aucune ligne de `BookingsService` au-delà de l'injection de dépendance.

**Négatif / dette assumée :** pas de protection anti-double-réservation locale quand `LEGACY_WRITE_ENABLED=false` (aucun arbitre, ni Legacy ni contrainte DB post-cutover) — acceptable en dev/test, à surveiller si ce mode était utilisé au-delà.
