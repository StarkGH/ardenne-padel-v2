# ADR 0012 — Garantie organisateur et orchestration SPLIT

## Statut
Accepté

## Date
2026-08-14

## Contexte

Le CDC §25-§26 exige que le paiement partagé (SPLIT) repose sur une garantie organisateur unique (carte off-session ou wallet réservé, jamais les deux — §25.3), que chaque part payée réduise cette garantie à due proportion (§26), et que la séquence reste aussi sûre financièrement que le paiement FULL (jamais de confirmation Legacy sans garantie posée, jamais de capture sans confirmation Legacy — §27.1). Il fallait décider comment réutiliser l'infrastructure du Lot 5 (holds wallet) et du Lot 4 (autorisation/capture Stripe) sans dupliquer toute l'orchestration Legacy.

## Décision

### 1. `SplitCheckoutService` séparé de `CheckoutService`

Plutôt que de fusionner la logique SPLIT dans `CheckoutService` (déjà dense après le Lot 5 — hold wallet + autorisation carte mixtes), un service dédié gère la séquence propre au SPLIT : payer la part organisateur → poser la garantie → créer en Legacy → capturer. L'ordre diffère du FULL (la garantie est posée *avant* Legacy, contrairement à l'autorisation Stripe simple qui suffit) — fusionner aurait rendu `CheckoutService` difficile à suivre. Les deux services restent joignables depuis le même endpoint `POST /payments/checkout` (CDC §43), dispatché selon `booking.paymentMode`.

### 2. Découverte en cours de route : la libération partielle de garantie ne réduisait pas le hold wallet sous-jacent

Un test d'intégration (`releases the wallet guarantee proportionally...`) a révélé que `BookingGuaranteeService.releaseForPaidShare` ne touchait que la ligne `booking_guarantees` — jamais le `wallet_holds.amountCents` sous-jacent, laissant `balance_reserved` faux après un paiement partiel de part. Corrigé en ajoutant `WalletRepository.reduceHoldAmount` (décrément atomique conditionnel, même famille que les autres transitions de hold — CDC §47.2.bis) et `WalletService.releaseHoldPartially`. C'est exactement le genre de défaut d'intégrité financière que les tests d'intégration contre une vraie base sont censés attraper — noté ici pour rappeler que ce chemin mérite une vigilance particulière si le mécanisme de garantie évolue.

### 3. Débits/remboursements de parts réutilisent le ledger du Lot 5 sans modification

`BookingShareService.payShare` appelle `WalletService.debitForBooking` (participant) exactement comme un débit de réservation classique — aucune nouvelle primitive wallet n'a été nécessaire. La garantie organisateur et le paiement d'une part restent deux comptes wallet indépendants (celui de l'organisateur pour le hold, celui du participant pour son propre débit), jamais mélangés.

### 4. Simplifications assumées pour ce lot

- **Pas de 3D Secure pour la part organisateur en SPLIT** : contrairement au FULL (webhook `payment_intent.amount_capturable_updated`), une carte nécessitant une authentification forte fait échouer le checkout SPLIT avec un message explicite plutôt qu'une reprise asynchrone. Le FULL sert de référence pour ajouter cette reprise si nécessaire — pas dupliqué ici faute de temps.
- **Garantie carte (`CARD_OFF_SESSION`) sans vérification stricte du consentement** : le `paymentMethodId` fourni est supposé déjà réutilisable (obtenu via `POST /payments/setup` + confirmation côté client). Le backend ne vérifie pas activement ce consentement — un débit off-session sans consentement valide serait simplement refusé par Stripe au moment de la régularisation. Point à revalider avec de vraies clés Stripe (V-013 du CDC).
- **Régularisation non automatisée** : `BookingGuaranteeService.captureRemaining` et `BookingShareService.coverUnpaidSharesWithGuarantee` existent et sont testés, mais rien ne les déclenche automatiquement à l'échéance — dépend de l'infrastructure de jobs (Lot 7/8), cohérent avec les limitations déjà documentées pour la synchronisation Legacy.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Fusionner SPLIT dans `CheckoutService.checkout()` | Aurait ajouté une troisième branche (wallet mixte + SPLIT) à une méthode déjà complexe, au détriment de la lisibilité |
| Modéliser la garantie comme un simple champ sur `Booking` | Le CDC §25.4 définit `booking_guarantees` comme une table dédiée avec son propre cycle de vie (ACTIVE/PARTIALLY_RELEASED/CONSUMED/RELEASED/FAILED) — nécessaire pour distinguer plusieurs tentatives/historique |
| Combiner garantie carte + wallet | Explicitement interdit par CDC §25.3 pour le MVP |

## Conséquences

**Positif :** 15 tests dédiés (calcul des parts, orchestration complète, libération proportionnelle, régularisation carte) valident le chemin financier le plus complexe du CDC jusqu'ici, sur une vraie base PostgreSQL. Le bug de libération partielle aurait été très difficile à repérer sans ces tests — confirme la valeur des tests d'intégration réels par rapport à des mocks.

**Négatif / dette assumée :** pas de reprise 3DS pour l'organisateur en SPLIT, pas de déclenchement automatique de la régularisation, pas de vérification active du consentement carte — tous documentés ci-dessus comme limitations explicites, pas des oublis silencieux.
