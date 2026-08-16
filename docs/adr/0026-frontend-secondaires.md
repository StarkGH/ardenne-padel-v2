# ADR 0026 — Écrans client/kiosque secondaires : participants post-création et recharge kiosque

## Statut
Accepté

## Date
2026-08-16

## Contexte

Les "actions immédiates" de `PLAN_ACTION.md` listaient, après les 25 écrans admin (ADR-0024/0025), un troisième chantier : "compléter les écrans client/kiosque secondaires listés en 'Restant' dans les sections Frontend Lot 1 à 5 (paiement pack de crédits, gestion des participants post-création, écran de recharge kiosque dédié, etc.)". Deux gaps concrets en ressortent, tous deux déjà couverts côté backend sans aucune API manquante :

1. **Gestion des participants après création** (ADR-0020 §3) : le brouillon de `/book` permet d'ajouter des participants *avant* le paiement, mais rien ne permet de corriger cette liste une fois la réservation créée (SPLIT, statut `CHECKOUT_PENDING`, avant validation finale). `POST/DELETE /bookings/:id/participants` existent depuis le Lot 3 mais n'étaient jamais appelés après l'écran `/book`.
2. **Écran de recharge kiosque dédié** (écran 8, CDC §54.1, ADR-0023) : le lot kiosque avait délibérément renvoyé vers `/wallet/packs` après identification, sans construire d'écran propre au kiosque.

Le "changement d'e-mail" (également listé en Restant du Lot 4) n'est volontairement **pas** traité ici : c'est une capacité backend manquante (jeton de re-vérification, pas seulement un écran) plutôt qu'un écran secondaire — hors périmètre de ce lot, qui ne touche à aucune route.

## Décision

### 1. Gestion des participants directement sur l'écran de checkout SPLIT, pas un écran séparé

`SplitCheckout` (`/checkout/[bookingId]`) porte désormais sa propre section "Participants" — ajout/retrait, avec rechargement de la réservation *et* de l'aperçu de répartition (`GET /bookings/:id/split-preview`) après chaque changement, puisque le prix par part dépend directement du nombre de participants. Choix délibéré de ne pas construire un écran de gestion séparé (`/bookings/:id/participants` par exemple) : la contrainte backend (`BookingsService.addParticipant`/`removeParticipant`) limite déjà cette action aux statuts `DRAFT`/`CHECKOUT_PENDING`, c'est-à-dire exactement la fenêtre où l'organisateur se trouve déjà sur l'écran de checkout — y ajouter la gestion évite un aller-retour entre deux pages pour une action qui n'a de sens que là.

### 2. Recharge kiosque : composant partagé, pas une deuxième implémentation du parcours d'achat

`/wallet/packs` et le nouvel écran `/kiosk/credits` partagent désormais le même composant (`CreditPacksPurchase`, `apps/web/src/components/credit-packs-purchase.tsx`), paramétré par le titre affiché, la destination de connexion (`?next=`) et la destination après achat. Aucune deuxième logique d'appel API n'a été écrite : dupliquer ~100 lignes quasi identiques (recherche des packs, achat, dégradation `STRIPE_NOT_CONFIGURED`) pour un habillage différent aurait risqué une divergence silencieuse entre les deux parcours au premier changement futur de l'un des deux. Un lien "Acheter ou recharger des crédits" a été ajouté à l'accueil kiosque (`/kiosk`), au même niveau que la sélection de réservation — l'écran 8 n'est pas rattaché à une réservation, un client peut vouloir recharger son wallet sans jamais réserver un terrain.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Écran de gestion des participants séparé, accessible depuis le détail de réservation | La fenêtre de modification (statuts `DRAFT`/`CHECKOUT_PENDING`) coïncide exactement avec l'écran de checkout — un écran séparé aurait ajouté une navigation sans ajouter de capacité |
| Dupliquer le parcours d'achat de packs pour le kiosque, avec sa propre logique | Même appel API (`GET /credit-packs`, `POST /credit-packs/:id/purchase`), même dégradation Stripe — dupliquer aurait introduit un risque de divergence au premier changement de l'un des deux parcours sans que l'autre suive |
| Traiter le changement d'e-mail dans ce lot | Nécessite une vraie capacité backend (jeton de re-vérification pointant vers une nouvelle adresse), pas seulement un écran manquant — distinct par nature des deux gaps traités ici, qui n'ont exigé aucune route nouvelle |

## Conséquences

**Positif :** les deux gaps vérifiés en direct dans un navigateur réel. Participants : une réservation SPLIT créée avec 1 participant dans l'assistant `/book`, un deuxième ajouté depuis l'écran de checkout (répartition recalculée en direct de 24,00 €/24,00 € à 16,00 €/16,00 €/16,00 € pour 3 personnes), puis retiré (répartition revenue à 24,00 €/24,00 €) — confirmant que l'aperçu de répartition se resynchronise correctement à chaque changement. Kiosque : nouvel écran `/kiosk/credits` atteint depuis l'accueil kiosque, packs réels affichés, tentative d'achat dégradée proprement (`STRIPE_NOT_CONFIGURED`, cohérent avec tout le reste du site) ; `/wallet/packs` revérifié fonctionnel après le refactor vers le composant partagé. Aucun ajout backend, aucune régression de build/lint/tests (206 tests toujours verts).

**Négatif / dette assumée :** le changement d'e-mail reste non traité (capacité backend manquante, pas un écran). Pas de limite explicite affichée si un participant est ajouté alors que la capacité du terrain est atteinte au-delà de ce que le formulaire masque déjà (le bouton d'ajout disparaît, mais aucun message n'explique pourquoi). Pas de déduplication côté client si le même e-mail est ajouté deux fois comme participant (le backend accepterait, aucune règle métier ne l'interdit explicitement dans ce lot).
