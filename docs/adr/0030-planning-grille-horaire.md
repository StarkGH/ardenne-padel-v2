# ADR 0030 — Planning admin en grille horaire

## Statut
Accepté

## Date
2026-08-17

## Contexte

`/admin/planning` (Lot 6, ADR-0024) listait les réservations du jour sous forme de cartes empilées, une section par terrain. Fonctionnel, mais deux limites concrètes : il faut lire la liste pour comprendre l'occupation réelle des terrains (pas de vue d'ensemble instantanée), et aucune interaction directe n'existe avec un créneau vide — créer une réservation pour un horaire précis exige de rouvrir `/admin/bookings/new` et de tout ressaisir (terrain, date, heure). Les logiciels de réservation sportive du marché (Doinsport compris — page consultée, mais protégée par connexion ; patron confirmé par leur documentation d'aide, `support.doinsport.com/introduction-planning`) suivent tous le même patron : une grille "resource calendar", terrains en colonnes, heures en lignes.

## Décision

### 1. Grille CSS, pas une bibliothèque de calendrier tierce

`display: grid` avec `gridTemplateRows`/`gridTemplateColumns` calculés dynamiquement en `style` inline (les classes Tailwind générées dynamiquement ne seraient pas détectées par le scan statique du build). Pas de dépendance externe (`react-big-calendar`, `fullcalendar`, etc.) pour un besoin aussi ciblé — cohérent avec le reste du projet, qui n'a jamais introduit de bibliothèque de calendrier même pour le générateur de QR (Lot 5) ou l'affichage de créneaux (`/book`).

### 2. Fenêtre horaire fixe (07h-23h), étendue si une réservation déborde

Aucune route n'expose facilement "les heures d'ouverture agrégées de tous les terrains pour ce jour" (`GET /availability` ne retourne que les créneaux *libres*, pas les horaires bruts). Plutôt que d'ajouter un nouvel endpoint pour un affichage, la grille part d'une fenêtre par défaut généreuse (07h-23h, couvrant les horaires seedés 08h-22h avec marge) et l'étend automatiquement si une réservation réelle déborde — jamais de créneau invisible.

### 3. Créneaux vides cliquables sans vérifier la disponibilité par cellule

Vérifier individuellement chaque cellule vide (terrains × créneaux de 30 min sur 16h ≈ 128 appels pour 4 terrains) serait coûteux pour un gain marginal : le clic redirige vers `/admin/bookings/new` qui revérifie de toute façon la disponibilité réelle via `GET /availability` avant de proposer le créneau. Si le créneau cliqué n'est plus libre entre-temps (concurrence), le pré-remplissage échoue silencieusement et l'admin choisit manuellement — aucune casse, juste une perte du raccourci.

### 4. Pré-remplissage par paramètres d'URL, pas par état partagé

`/admin/planning` redirige vers `/admin/bookings/new?courtId=&date=&time=` plutôt que de partager un store client. Cohérent avec le reste de l'admin (aucun état global n'existe entre écrans) et rend le lien partageable/rechargeable. Le pré-remplissage ne s'applique qu'*après* le choix du client (étape 1, inchangée) — la grille ne connaît pas le client, seulement le créneau.

### 5. Réservations `CANCELED` exclues de la grille, pas seulement grisées

L'ancienne vue liste affichait toutes les réservations avec leur statut, y compris annulées. La grille les exclut entièrement : une réservation annulée libère réellement le créneau, l'afficher grisé aurait empêché le clic sur cette case sans raison (aurait fallu une logique supplémentaire pour la rendre "cliquable sous le bloc annulé").

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Bibliothèque de calendrier tierce (`react-big-calendar`, `fullcalendar`) | Dépendance supplémentaire pour un besoin qu'une grille CSS de ~150 lignes couvre entièrement ; aucune bibliothèque de ce type n'a été introduite ailleurs dans le projet |
| Nouvel endpoint `GET /admin/schedule/window` pour les horaires agrégés | Ajoute une route pour un besoin d'affichage résolu plus simplement par une fenêtre par défaut extensible ; les vraies heures d'ouverture par terrain restent consultables sur `/admin/schedule` |
| Vérifier la disponibilité de chaque cellule vide avant de l'afficher cliquable | Coût en appels API disproportionné ; `/admin/bookings/new` revérifie de toute façon avant de proposer le créneau |
| Garder les réservations annulées visibles (grisées) dans la grille | Complique le rendu (case à la fois "occupée visuellement" et "cliquable pour une nouvelle réservation") sans bénéfice réel — l'historique reste consultable via le détail réservation |

## Conséquences

**Positif :** vérifié en direct de bout en bout — grille affichée avec les 4 terrains en colonnes et les heures en lignes (07h-22h), clic sur une case vide (Padel 1, 10h00) redirige vers la création avec type de terrain/terrain/date/créneau tous pré-sélectionnés automatiquement une fois le client choisi, réservation créée (24,00 €), bloc "Joueur Un / En attente de paiement" apparu dans la grille occupant exactement les deux demi-heures de la réservation (10h00 et 10h30 disparues des cases cliquables), clic sur le bloc mène bien au détail de la réservation. Build et lint propres, 218 tests backend inchangés (aucune modification backend dans ce lot).

**Négatif / dette assumée :** pas de vérification de disponibilité par cellule (voir Décision 3) — filet de sécurité côté formulaire, pas une garantie a priori. Fenêtre horaire fixe plutôt que les vraies heures d'ouverture par terrain (voir Décision 2) — un terrain fermé un jour donné affiche quand même des cases cliquables dans sa plage, qui échoueront simplement à la création. Pas de gestion visuelle des chevauchements si deux réservations occupent accidentellement le même terrain/créneau (cas déjà anormal, non traité davantage que dans l'ancienne vue liste).
