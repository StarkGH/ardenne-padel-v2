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

## Addendum (2026-08-17) — Occupations Doinsport-only invisibles sur la grille

**Bug réel signalé par l'utilisateur** : "je ne vois pas dans la grille du planning les réservations de Doinsport". Investigation : le scheduler de synchro (ADR-0035) alimentait bien `LegacyBooking` en continu (confirmé, 47-68 réservations réelles synchronisées) et l'anti-collision (ADR-0033) les prenait bien en compte pour bloquer la disponibilité — mais `BookingsAdminService.listForDashboard` (`GET /admin/bookings`, ce que consomme la grille) n'a **jamais** interrogé `LegacyBooking`, seulement `Booking` (V2). Un admin ouvrant le planning voyait des cases vides et cliquables à des horaires en réalité occupés côté Doinsport — la création échouait alors en 422 à la validation, mais seulement après coup, jamais visible sur la grille elle-même.

**Correctif** : nouvelle route `GET /admin/legacy-bookings` (`BookingsAdminService.listLegacyForDashboard`, `BookingsRepository.listLegacyOccupationsInRange`) renvoyant les occupations Doinsport-only (id, terrain, créneau, nom client si résolu) sur la même fenêtre que `/admin/bookings`. Volontairement une route séparée plutôt que fusionnée dans `/admin/bookings` : deux tables/objets métier distincts (`Booking` V2 vs `LegacyBooking` importé), et `/admin/bookings` reste consommé ailleurs (dashboard, écran de synchro) sans qu'il soit pertinent d'y mélanger des occupations non annulables/non consultables en détail depuis V2. Le planning (`/admin/planning`) affiche désormais ces occupations en blocs distincts (hachurés violets, libellés "Doinsport") — non cliquables (pas de détail de réservation côté V2 pour un objet Doinsport-only) et comptabilisés dans les créneaux occupés, empêchant le bouton "créer une réservation" d'apparaître dessus.

Vérifié en direct : 7 réservations Doinsport réelles synchronisées sur une journée test, toutes affichées sur la grille avec le bon terrain/créneau, créneaux correspondants effectivement retirés des cases cliquables. 1 nouveau test backend (`bookings-admin.service.test.ts`, 260 tests au total, 42 fichiers verts). Données réelles nettoyées de la base de dev après vérification.

**Dette assumée** : nom client Doinsport affiché "Client Doinsport" en repli si la réconciliation `LegacyClient` (cycle 300s) n'a pas encore tourné depuis le dernier import — cohérent avec le fonctionnement déjà eventually-consistent du scheduler (ADR-0035), pas un bug de cet addendum.

## Addendum 2 (2026-08-18) — Planning enrichi : fenêtre 8h-23h30, participants, statut de paiement

Demande utilisateur directe, trois volets :

1. **Fenêtre horaire** : `DEFAULT_START_MIN`/`DEFAULT_END_MIN` passés de 7h-23h à 8h-23h30 (`apps/web/src/app/admin/planning/page.tsx`).

2. **Participants affichés dans chaque bloc Doinsport**, avec nombre de réservations non annulées par joueur — format `"Alain Monfort (101) / Alain Samray (80)"`, troncature via CSS (`truncate`, pas de calcul de caractères côté JS). Nécessite une donnée qui n'existait pas du tout : `LegacyBooking` ne stockait que le propriétaire (`legacyClientId`), jamais la liste complète des participants. Nouvelle table **`legacy_booking_participants`** (une ligne par participant, régénérée entièrement à chaque resynchro de la réservation parente plutôt qu'un upsert incrémental — Doinsport n'expose aucun id stable par participant, cascade sur `LegacyBooking`). Le compteur `activeBookingsCount` est calculé et écrit **à l'import** (`legacy-import.service.ts`, une passe finale par client touché après la boucle principale) — jamais recalculé à l'affichage, conformément à la demande explicite. Portée du compteur : uniquement ce que V2 a synchronisé (mêmes fenêtres que le scheduler, ADR-0035), pas l'historique Doinsport complet.

3. **Avertissement ⚠️ si non payé** — **au niveau de la réservation entière, jamais par participant**. Investigation empirique avant d'écrire le moindre code (plusieurs réservations réelles à 2+ participants récupérées via `getBooking`) : `raw.payments[].participantId` ne correspond à **aucun** identifiant exposé ailleurs dans `raw.participants[]` (ni `client.id`, ni `user.id`, ni `createdBy.id`). Aucune association fiable participant↔paiement n'est possible avec les données exposées par cette réponse d'API — une supposition positionnelle aurait un risque réel de désigner la mauvaise personne comme n'ayant pas payé, pire que l'absence d'information. `LegacyBooking.fullyPaid` (nouveau champ, défaut `true`) compare donc le total dû (participants non annulés) au total encaissé (`payments[].payment.status === "succeeded"`), calculé par la fonction pure `computeFullyPaid` (`booking-participants.ts`, testée unitairement par fixtures — même convention que `client-dedup.ts`).

Vérifié en conditions réelles : import manuel déclenché sur une fenêtre de 3 jours, 17 réservations réelles récupérées, participants et compteurs corrects affichés en direct sur `/admin/planning` (ex. `"Stéphane Krzyszkowski (2) / manu renson (1) / corentin Muller (1) / Noel Renson (1)"`), une réservation réelle détectée non intégralement payée affichant bien `⚠️`. 8 nouveaux tests purs (`booking-participants.test.ts`) + 1 test d'intégration import (`legacy-sync-scheduler.test.ts`) + 1 test service (`bookings-admin.service.test.ts`) — 270 tests au total, 43 fichiers verts.

**Dette assumée** : le statut de paiement reste agrégé, pas nominatif — un admin sait qu'une réservation a un solde impayé mais pas lequel des participants en est la cause.

### Correction en cours de route — le compteur doit couvrir tout Doinsport, pas seulement ce que V2 a synchronisé

Demande explicite de l'utilisateur après la première version : "tu ne dois pas calculer le nb de réservation dans le V2 mais dans l'ensemble Doinsport". Un compteur purement local (`legacyBookingParticipant.count()`) est structurellement incomplet — il ne reflète que les fenêtres déjà couvertes par le scheduler (ADR-0035 : `-1h/+30j` en sync fréquente, `-1j/+1an` en réconciliation), jamais l'historique antérieur au démarrage de la synchro.

Investigation empirique (avant tout code) : `/clubs/bookings/listing` avec `filter[status]` (paramètre déjà utilisé par la correction concurrente de `listBookings()` pour le même type de problème — voir plus haut) accepte aussi un filtre `participants.client.id`, confirmé fonctionnel en direct. En combinant les deux appels `filter[status]=before` et `filter[status]=after` (comme `listBookings()`) et en sommant leurs `totalItems`, on obtient un vrai décompte Doinsport complet — vérifié en direct sur un client réel : 11 (futur seul, ancienne approche) → 131 (historique + futur, nouvelle approche).

Nouvelle méthode `LegacyBookingProvider.countActiveBookingsForClient(legacyClientId)` (interface étendue, implémentée dans l'adapter, un item par page — seul `totalItems` intéresse). Appelée en direct à l'import (une fois par client touché, comme avant) plutôt que calculée en base — coût réseau assumé (deux requêtes légères par client par cycle de sync) en échange d'un chiffre réellement exact, conformément à la demande.

Vérifié en re-déclenchant un import réel : le compteur d'Alain Monfort passe de 12 (local, sous-estimé) à 131 (Doinsport complet), cohérent avec l'écart attendu. Tests mis à jour en conséquence (le double de test `FakeLegacyProvider` expose désormais `countActiveBookingsForClient`, piloté par fixture plutôt que dérivé de l'état local). 270 tests au total, 43 fichiers verts.

**Gap identifié en répondant à la question de l'utilisateur ("les compteurs ne s'affichent que pour le futur ?")** : sur 4284 réservations Doinsport déjà en base ce jour-là, seules 14 réservations passées avaient des lignes `LegacyBookingParticipant` (contre 41 des 67 futures) — l'extraction de participants n'existant pas au moment du gros import historique initial, et le scheduler récurrent ne revisitant jamais le passé lointain, ces anciennes lignes ne sont jamais rattrapées automatiquement. Effectivement vrai : les noms/compteurs/notes ne s'affichent en pratique que sur ce qui a été (re)synchronisé récemment. Rattrapage historique complet non fait dans ce lot (nécessiterait de relancer `getBooking()` sur des milliers de réservations, coût réseau/temps significatif) — signalé à l'utilisateur plutôt que traité silencieusement.

### Addendum 3 (2026-08-18) — Notes de réservation en italique, hauteur de cellule pleinement exploitée

Deux demandes utilisateur : (1) le bloc n'utilisait que sa première ligne (`truncate`, une seule ligne, quelle que soit la hauteur réelle de la cellule) ; (2) la note Doinsport (`LegacyBooking.comment`, déjà stockée depuis ADR-0031 mais jamais affichée) doit apparaître en italique.

`maxParticipantLines(rowSpan, hasNote)` calcule désormais le nombre de lignes réellement disponibles à partir de la hauteur de cellule (`rowSpan * 28px`, synchronisé avec `gridTemplateRows`), moins la ligne "Doinsport" toujours réservée en bas et, le cas échéant, la ligne de note — appliqué via `WebkitLineClamp` (troncature avec ellipse uniquement si le contenu dépasse l'espace réellement disponible, jamais avant). Bloc restructuré en `flex flex-col justify-between h-full` : participants en haut (autant de lignes que la place le permet), note en italique juste avant, "Doinsport" toujours en dernière ligne quelle que soit la hauteur de la cellule.

Vérifié en direct sur de vraies réservations avec note ("Tournoi", "Inter équipe") : la note s'affiche bien en italique entre les participants et la ligne "Doinsport". Build et lint propres, 270 tests inchangés (changement purement visuel côté service : un champ `comment` supplémentaire exposé, testé dans `bookings-admin.service.test.ts`).

### Addendum 4 (2026-08-18) — Taux de remplissage, en-tête figé au scroll, chiffre d'affaires

Trois demandes utilisateur enchaînées : (1) taux de remplissage par terrain (créneaux de 30 min réservés vs disponibles, 8h-23h30 et sur la journée réellement affichée), (2) en-tête (date + taux) figé au défilement, (3) chiffre d'affaires jour/semaine/mois affiché à côté de la date.

**Occupation** — `computeOccupancy(courtId, ranges, fromMin, toMin)` (V2 + Doinsport confondus, même logique de fusion que le reste de la grille) et `computeGlobalOccupancy` (somme tous terrains). Affichées à deux niveaux : par terrain dans l'en-tête colonnes, et un total global à côté de la date — chacun décliné sur la fenêtre fixe 8h-23h30 et sur la fenêtre réellement affichée (qui peut déborder si une réservation dépasse ces bornes), comme demandé explicitement.

**En-tête figé — trois obstacles réels rencontrés, dans l'ordre** :
1. `position: sticky` posé directement sur un item de CSS Grid (la cellule d'en-tête, `gridRow: 1` de la grille du corps) ne s'accroche pas de façon fiable — constaté en direct (l'élément défile avec la page malgré `position: sticky` correctement calculé). Corrigé en sortant l'en-tête de colonnes de la grille du corps, dans son propre conteneur.
2. Une fois sorti, toujours cassé : `overflow-x-auto` sur le conteneur parent fait *implicitement* passer `overflow-y` en `auto` (règle CSS — un axe non-`visible` force l'autre à `auto` s'il valait `visible`), transformant ce parent en véritable contexte de défilement. Un `overflow-y: visible` explicite (classe Tailwind puis style inline) n'y change **rien** : le navigateur calcule quand même `overflow-y` à `auto`, confirmé en lisant `getComputedStyle` en direct. Aucun contournement CSS pur trouvé. Corrigé en sortant l'en-tête colonnes du conteneur `overflow-x-auto` du tout — nouveau conteneur `sticky` séparé (même mécanisme que la barre de date, qui elle fonctionnait depuis le début), avec son propre `overflow-hidden` et le défilement horizontal du corps recopié dessus en JS (`onScroll` + `scrollLeft`) pour garder les colonnes alignées.
3. Le décalage vertical (`top`) de l'en-tête colonnes doit égaler la hauteur réelle de la barre de date au-dessus, qui varie une fois les données (remplissage, CA) chargées et ajoutent des lignes. Une valeur codée en dur (60px) s'est révélée fausse dès que la barre grandissait. Un `ResizeObserver` sur la barre de date s'est révélé **peu fiable** pour capter ce changement de taille précis (cause non identifiée, observé en direct : la hauteur DOM réelle passait à 80px sans que l'observer ne redéclenche). Remplacé par une mesure directe (`dateBarRef.current.offsetHeight`) dans un `useLayoutEffect` dépendant explicitement des données qui changent le contenu de la barre (`bookings`, `periodBookings`, `courts`) — fiable, vérifié en direct (60px → 80px correctement répercuté, plus aucun chevauchement avec la ligne 8h-9h de la grille signalé par l'utilisateur au premier essai).

**Chiffre d'affaires** — jour/semaine/mois, reconnu par date de jeu (`startAt`) et non par date de confirmation (`Booking.confirmedAt`, utilisée par `/admin/reports` pour la déclaration TVA — sémantique différente, volontairement pas réutilisée ici puisque cet écran parle de créneaux joués, pas de comptabilité). Réservations V2 `CONFIRMED`/`COMPLETED` uniquement — les réservations Doinsport-only ne sont pas incluses (`LegacyBooking` ne stocke pas de prix localement). Un seul appel `/admin/bookings` sur une fenêtre couvrant à la fois la semaine et le mois de la date affichée (elles peuvent chevaucher deux mois calendaires), jour/semaine/mois recalculés localement par filtrage plutôt que trois requêtes séparées.

Vérifié en direct de bout en bout : réservation V2 confirmée insérée manuellement (24,00 €), CA jour/semaine/mois affiché correctement, remplissage du terrain concerné mis à jour, sticky vérifié par lecture directe de `getBoundingClientRect`/`getComputedStyle` avant/après défilement programmatique (le panneau navigateur ne permet pas de capture d'écran dans cet environnement). Données de test nettoyées après vérification. Build et lint propres, 270 tests backend inchangés (aucun changement backend dans cet addendum).
