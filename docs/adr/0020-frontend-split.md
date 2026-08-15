# ADR 0020 — Parcours frontend SPLIT (paiement partagé)

## Statut
Accepté

## Date
2026-08-15

## Contexte

Après ADR-0019 (fondations + parcours FULL online), ce lot construit le parcours de paiement partagé côté client (CDC §54 écrans 6, 8, 9, 20-23) — le pendant frontend du Lot 6 backend (SPLIT). Deux endpoints backend manquaient pour servir ce parcours sans dupliquer de logique métier côté client (CDC §129) : un aperçu des parts avant validation, et une consultation du statut des parts pour l'organisateur après confirmation.

## Décision

### 1. Deux ajouts backend minimaux, justifiés par un besoin frontend concret

- `GET /bookings/:id/split-preview` (`SplitCheckoutService.previewShares`) — recalcule exactement la même chose que `checkout()` (mêmes validations, même `computeSplitShares`), **sans aucun effet de bord** (pas de réclamation atomique, pas de paiement). Nécessaire pour satisfaire CDC §24.5/écran 23 ("frais de service split visible avant confirmation") sans dupliquer le calcul de répartition côté frontend, ce qui aurait violé CDC §129 et risqué une divergence entre l'aperçu et le montant réellement facturé.
- `GET /bookings/:id/shares` (`BookingShareService.listSharesForOrganizer`) — l'organisateur n'avait jusqu'ici aucun moyen authentifié de consulter le statut des parts de sa propre réservation (`GET /booking-shares/:token` existait déjà mais réclame un token d'invitation, pas une session organisateur). Nécessaire pour l'écran de détail de réservation (CDC §54 écran 13).

Les deux routes vérifient `booking.organizerUserId === req.authUser.id`, testées côté backend (403 pour un tiers) avant d'être consommées côté frontend.

### 2. La récupération de session après connexion couvre aussi les participants

Le brouillon de réservation (`sessionStorage`) persiste désormais `paymentMode` et la liste des participants (nom + e-mail), pas seulement terrain/créneau/durée (ADR-0019). Un organisateur qui bascule en SPLIT, ajoute des participants, puis doit se connecter, retrouve l'intégralité de sa saisie au retour — vérifié en direct dans le navigateur.

### 3. Les participants sont créés après la réservation, avant le paiement

`POST /bookings` (avec `paymentMode: "SPLIT"`) puis une boucle de `POST /bookings/:id/participants` par participant saisi — dans cet ordre, parce que l'API n'accepte les participants qu'une fois la réservation existante. Si l'ajout d'un participant échoue en cours de boucle, l'erreur remonte telle quelle à l'utilisateur ; il n'existe pas encore d'écran permettant de corriger/compléter les participants d'une réservation déjà créée mais pas encore payée — limite documentée plutôt que traitée par une reprise automatique non demandée.

### 4. Écran de garantie (21) et de consentement (22) : choix binaire, pas de collecte de carte réelle

Comme pour le paiement FULL (ADR-0019 §5), aucune intégration Stripe Elements/SetupIntent réelle n'est câblée (pas de compte Stripe, ADR-0010). L'écran de garantie propose les deux mécanismes (`WALLET_RESERVE`/`CARD_OFF_SESSION`) prévus par le CDC §25.3 (un seul actif à la fois) ; le choix `CARD_OFF_SESSION` déclenche l'écran de consentement explicite (case à cocher obligatoire) avant d'activer le bouton de paiement — la collecte réelle du moyen de paiement reste à câbler avec Stripe.js le jour venu, exactement comme pour `/checkout` FULL.

### 5. Le paiement d'une part (écran 20, `/pay/[token]`) n'a pas pu être vérifié de bout en bout en direct

La création réelle des parts et des invitations n'intervient qu'après la capture du paiement de l'organisateur (`SplitCheckoutService.checkout`, étape 5) — qui échoue systématiquement en 503 sans compte Stripe, comme pour tout le reste du projet. Aucune part/invitation n'est donc jamais créée en conditions de développement réelles. La page `/pay/[token]` a été vérifiée pour son cas d'erreur (jeton inconnu → message propre) ; le parcours complet (paiement d'une part via wallet ou carte) reste couvert uniquement par les tests backend (`split-checkout.service.test.ts`, avec `FakePaymentProvider`) — même limite méthodologique que chaque lot de paiement depuis le Lot 4.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Recalculer les parts/frais côté frontend à partir du prix total et du nombre de participants | Duplique une règle métier (CDC §129) ; risque de divergence si la logique de répartition évolue côté backend (ex. `PRO_RATA` vs `ORGANIZER`) sans mise à jour du frontend |
| Permettre de modifier les participants après création de la réservation, dans ce même lot | Les endpoints `POST/DELETE .../participants` existent déjà côté backend, mais construire un écran de gestion dédié aurait élargi ce lot ; le flux actuel (participants saisis avant le paiement) couvre le cas nominal |
| Construire un vrai SetupIntent Stripe.js pour l'écran de consentement | Nécessite un compte Stripe réel pour être testé significativement ; le choix/consentement UI est déjà fonctionnel et prêt à recevoir l'intégration réelle |

## Conséquences

**Positif :** parcours SPLIT vérifié en direct dans un navigateur réel jusqu'à la limite imposée par l'absence de compte Stripe (réservation SPLIT créée avec participant, reprise de sélection après connexion incluant les participants, aperçu de répartition en temps réel depuis l'API, écran de garantie avec consentement conditionnel, dégradation propre `STRIPE_NOT_CONFIGURED`). 2 endpoints backend ajoutés avec tests dédiés (4 nouveaux tests dans `split-checkout.service.test.ts`, 180 au total côté backend). Build et lint frontend propres.

**Négatif / dette assumée :** parcours de paiement d'une part par un participant invité (`/pay/[token]`) non vérifiable en direct (nécessite un compte Stripe pour qu'une invitation existe réellement) — couvert par les tests backend uniquement. Pas d'écran de gestion des participants après création de la réservation. Aucune intégration Stripe Elements/SetupIntent réelle. Les écrans wallet, profil, kiosque et les 25 écrans admin restent à construire.
