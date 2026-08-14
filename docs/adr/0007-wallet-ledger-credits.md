# ADR 0007 — Wallet ledger et crédits prépayés

## Statut
Accepté

## Date
2026-08-14

## Contexte

Le CDC §28 impose un wallet fermé (non transférable, pas de retrait, pas de P2P) avec un ledger append-only — jamais un solde recalculé par `balance += x` (CDC §111, anti-pattern explicite). Il fallait décider comment représenter le solde, les garanties temporaires (holds) et la composition payé/bonus de façon à ce qu'un remboursement puisse restituer fidèlement l'origine des crédits consommés (CDC §28.10), sans surface d'API compliquée ni double comptage.

## Décision

### 1. Solde toujours dérivé, jamais stocké

`balance_total` = somme des transactions qui affectent réellement le solde (`CREDIT_PACK_PURCHASE`, `CREDIT_PACK_BONUS`, `CREDIT_ADMIN`, `DEBIT_BOOKING`, `REFUND_BOOKING`, `ADJUSTMENT`, `BONUS_EXPIRY`). Les transactions `HOLD_CREATED`/`HOLD_RELEASED`/`HOLD_CAPTURED` sont une trace d'audit — elles ne comptent jamais dans `balance_total` (sinon double comptage avec le hold lui-même). `balance_reserved` = somme des `wallet_holds.status = ACTIVE`. `balance_available = total - reserved`. Aucune colonne `balance` mutable nulle part.

### 2. Consommation bonus-first

À la consommation (débit ou capture de hold), l'ordre `BONUS → PAID → ADMIN_COMP` est appliqué (`DEBIT_ORIGIN_ORDER` dans `wallet.service.ts`). Le CDC ne fixe pas d'ordre explicite ; ce choix limite le gaspillage de crédits bonus susceptibles d'expirer (CDC §28.5) — décision produit documentée ici, pas dans le CDC lui-même.

### 3. Débit multi-lignes plutôt qu'une transaction unique avec métadonnées

Un débit qui consomme à la fois du bonus et du payé produit **plusieurs lignes** `DEBIT_BOOKING` (une par origine réellement consommée), toutes reliées au même `booking_id`. Alternative écartée : une seule ligne avec un `metadata` JSON détaillant la répartition — écartée car elle aurait rendu le calcul de remboursement (`getDebitBreakdownForBooking`) dépendant du parsing JSON plutôt que d'une agrégation SQL simple (`groupBy`), plus fragile et moins auditable.

### 4. Remboursement proportionnel à la composition réellement consommée

`refundForBooking` calcule ce qui a déjà été débité par origine pour cette réservation (moins ce qui a déjà été remboursé, pour supporter des remboursements partiels successifs sans double remboursement), puis répartit le montant à rembourser au prorata. Un remboursement intégral restitue exactement la composition d'origine ; un remboursement partiel restitue chaque origine proportionnellement à ce qu'elle représentait dans le débit initial.

### 5. Idempotence des holds par transition atomique conditionnelle

`captureHold`/`releaseHold` utilisent `UPDATE ... WHERE status = 'ACTIVE'` (via `updateMany` + vérification du compte affecté) plutôt qu'un `findUnique` suivi d'un `update` séparé — élimine la fenêtre de race condition entre lecture et écriture (CDC §47.2.bis : un hold ne peut être capturé/libéré deux fois). Un second appel sur un hold déjà traité est un no-op silencieux, pas une erreur — cohérent avec le traitement idempotent des webhooks (CDC §44) qui peuvent déclencher cette suite plusieurs fois.

### 6. Paiement mixte wallet + Stripe unifié dans `CheckoutService`

Plutôt qu'un service wallet séparé dupliquant l'orchestration Legacy (CDC §27.1), `CheckoutService.checkout()` accepte un `applyWalletCents` optionnel : un hold wallet et/ou une autorisation Stripe sont posés avant la création Legacy, puis capturés ensemble seulement si Legacy confirme — symétrie complète entre "autoriser une carte" et "poser un hold wallet" (mêmes règles de void/capture, CDC §25 et §27.3 traités par le même code).

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Colonne `balance_cents` mutable sur `wallet_accounts` | Interdit explicitement par CDC §111 ; empêche toute restitution fidèle de la composition payé/bonus |
| Une seule ligne de débit avec répartition en JSON | Rend le calcul de remboursement dépendant du parsing JSON plutôt que d'une agrégation SQL |
| Service `WalletCheckoutService` séparé de `CheckoutService` | Aurait dupliqué toute l'orchestration Legacy (collision, erreur ambiguë, MANUAL_REVIEW) déjà écrite pour Stripe |
| Ordre de consommation payé-first | Envisagé mais écarté : gaspille les crédits bonus susceptibles d'expirer en premier |

## Conséquences

**Positif :** 25 tests dédiés (wallet + credit packs + checkout mixte) couvrant ledger, holds, remboursement proportionnel, idempotence — tous passent contre une vraie base PostgreSQL, pas des mocks. Le paiement 100% wallet et le paiement mixte partagent la même garantie de sécurité financière que le paiement carte pur (jamais de confirmation sans Legacy, jamais de capture sans Legacy confirmé).

**Négatif / dette assumée :** pas de politique d'expiration du bonus implémentée (CDC §28.5 le permet mais ne l'impose pas au MVP) — `BONUS_EXPIRY` existe dans l'enum mais aucun job ne l'émet encore (dépend de l'infrastructure de jobs, Lot 7/8). Le remboursement wallet n'est pas encore intégré automatiquement au flux d'annulation de réservation (CDC §29.3) — capacité disponible (`refundForBooking`), intégration complète prévue avec le Lot 9.
