# ADR 0021 — Parcours frontend Wallet / crédits prépayés

## Statut
Accepté

## Date
2026-08-15

## Contexte

Après ADR-0019 (fondations + FULL) et ADR-0020 (SPLIT), ce lot construit le parcours wallet côté client (CDC §54 écrans 15 "Wallet/solde crédits", 16 "Achat d'un pack de crédits", 17 "Historique wallet"), le pendant frontend du Lot 5 backend (comptabilité crédits, ADR-0015). Contrairement aux deux lots précédents, aucun ajout backend n'a été nécessaire : les endpoints `GET /me/wallet`, `GET /me/wallet/transactions`, `GET /credit-packs` et `POST /credit-packs/:id/purchase` existaient déjà et couvraient exactement les besoins des trois écrans.

## Décision

### 1. Le paiement mixte wallet + externe est ajouté au checkout FULL existant, pas à un écran séparé

Le CDC (Annexe B) prévoit qu'un solde wallet s'applique en priorité sur une réservation, le moyen de paiement externe ne couvrant que le reliquat. `FullCheckout` (`/checkout/[bookingId]`) a été étendu pour charger `GET /me/wallet` et proposer une case à cocher "Utiliser mon solde wallet" (visible uniquement si `availableCents > 0`). Le montant appliqué est `Math.min(wallet.availableCents, booking.priceTotalCents)` ; la carte "Moyen de paiement" ne s'affiche plus si le wallet couvre déjà la totalité (`remainingCents === 0`). Le calcul est fait côté client uniquement pour l'affichage — la requête `POST /payments/checkout` envoie `applyWalletCents` et laisse le backend appliquer/valider le montant réel (CDC §129), aucune règle de répartition n'est dupliquée.

### 2. Les écritures d'audit sur les holds sont affichées différemment dans l'historique

`WalletTransaction.type` inclut `HOLD_CREATED/HOLD_RELEASED/HOLD_CAPTURED`, des écritures de traçabilité qui ne changent jamais le solde réel (CDC §28.5 — seules `DEBIT_BOOKING`/`CREDIT_PACK_PURCHASE`/etc. affectent l'agrégat). `/wallet/history` les distingue visuellement (gris, sans signe +/−) des mouvements réels (vert `+`/noir `−`) pour éviter qu'un utilisateur ne les lise comme un double débit.

### 3. Achat de pack : même dégradation `STRIPE_NOT_CONFIGURED` que le reste du parcours de paiement

`/wallet/packs` liste les packs actifs (`displayOrder` croissant) et appelle `POST /credit-packs/:id/purchase` avec le même `paymentMethodId` de test qu'ailleurs (ADR-0019 §5, ADR-0010). Sans compte Stripe, l'achat échoue systématiquement en 503 et affiche le même bandeau informatif que FULL/SPLIT/`/pay/[token]` — cohérence de traitement sur tout le site plutôt qu'un cas particulier pour le wallet.

### 4. Vérification en direct d'un paiement 100 % wallet, sans aucune interaction Stripe

Comme aucun achat de pack ne peut réellement aboutir (pas de compte Stripe), le solde wallet de `joueur1@dev.ardenne-padel.local` a été crédité manuellement en base (100,00 € `PAID`, via SQL direct, script temporaire supprimé après usage) pour permettre une vérification de bout en bout. Une réservation FULL à 24,00 € a été créée, le wallet coché, et `POST /payments/checkout` appelé avec `applyWalletCents: 2400` : `CheckoutService.checkout()` emprunte la branche `remainingCents === 0` et n'appelle jamais `paymentProvider.createPayment` — la réservation passe directement à `CONFIRMED`. C'est la première vérification en conditions réelles de navigateur, depuis le début du projet, d'un paiement qui aboutit réellement plutôt que de se dégrader proprement en `STRIPE_NOT_CONFIGURED`. Le solde (76,00 €) et l'historique (`HOLD_CREATED` → `HOLD_CAPTURED` → `DEBIT_BOOKING -24,00 €`) ont été confirmés corrects après coup.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Écran de paiement mixte séparé du checkout FULL existant | Le CDC décrit un seul écran de paiement avec application du wallet en amont du moyen de paiement externe (Annexe B) ; un écran séparé aurait dupliqué la carte "Moyen de paiement" et le bouton de validation déjà présents |
| Calculer le montant wallet applicable côté client à partir d'une règle codée en dur | `Math.min(availableCents, priceTotalCents)` est un simple minimum, pas une règle métier — le backend reste seul juge de l'application réelle (validation, cohérence avec un hold éventuel), donc pas de violation de CDC §129 |
| Masquer les écritures `HOLD_*` de l'historique plutôt que de les afficher différemment | Le CDC ne demande pas de les cacher, seulement de ne pas les compter dans le solde ; les garder visibles (grisées) donne à l'utilisateur une traçabilité complète des garanties en cours, cohérent avec l'esprit de transparence du reste du wallet |

## Conséquences

**Positif :** les trois écrans wallet (solde/composition, achat de pack, historique) vérifiés en direct dans un navigateur réel avec des données réellement calculées par le backend (100,00 € puis 76,00 € après réservation, composition par origine, libellés français par type de transaction). Premier paiement réellement abouti (CONFIRMED sans dégradation Stripe) de tout le projet, prouvant que la branche 100 %-wallet de `CheckoutService` fonctionne de bout en bout, UI comprise. Build et lint frontend propres (les 128 problèmes de lint restants proviennent de fichiers générés `.next` et de `prisma/seed.ts`, préexistants et indépendants de ce lot — confirmé par `git stash`). Aucun ajout backend nécessaire.

**Négatif / dette assumée :** l'achat réel d'un pack de crédits reste non vérifiable en direct (dégradation `STRIPE_NOT_CONFIGURED`, comme FULL/SPLIT) — seul le seeding manuel en base a permis de tester le solde et l'historique avec des données réelles. Pas d'écran de gestion des transactions au-delà de la liste chronologique (pas de filtre par type/date). Les écrans profil, kiosque et les 25 écrans admin restent à construire.
