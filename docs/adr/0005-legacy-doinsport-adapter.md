# ADR 0005 — Doinsport Adapter et interface LegacyBookingProvider

## Statut
Accepté

## Date
2026-08-13

## Contexte

Le CDC §12 impose une interface stable `LegacyBookingProvider` derrière laquelle toute la logique Doinsport doit être confinée, avec un code d'audit existant (`padel-service/doinsport.js` et fichiers associés) qui ne doit pas être jeté (§72). Le Lot 2 doit produire un adapter testable, sans que le reste de l'application ne connaisse jamais les endpoints HTTP, le format IRI API Platform ou les structures `hydra:member` de Doinsport.

Contraintes spécifiques à trancher :
- comment référencer les terrains Legacy sans coupler le domaine à Doinsport (§2.5, §9, §14) ;
- comment résoudre `userClubId` de façon robuste plutôt que hardcodée (§13.1, point V-008 identifié dans `API-CATALOG.md`) ;
- comment porter l'algorithme de résolution tarifaire audité (§13.5, §74) sans qu'il devienne un appel réseau non testable ;
- comment traduire les erreurs Legacy sans jamais exposer de payload brut (§87).

## Décision

### 1. Court mapping local minimal, propriété du module Legacy

Une table `courts` minimale (CDC §9 — rien de plus que les champs listés) a été introduite dès le Lot 2 pour donner un sens à `legacy_court_mapping` (CDC §14) et permettre des tests réels dès maintenant. Le Lot 3 (Booking core) l'enrichira (availability/pricing) sans la redéfinir. `legacy_court_mapping` reste une table dédiée au module `legacy-doinsport`, jamais consultée directement par les futurs modules `bookings`/`pricing` — ceux-ci passeront toujours par `LegacyBookingProvider`.

`legacy_clients` (CDC §45) fait aussi office de `legacy_user_mapping` (CDC §14) : les deux définitions du CDC se recouvraient (`linked_user_id` ≈ `user_id`/`shadow_client_id`) ; une seule table plutôt que deux redondantes, conformément au principe CDC §0 ("solution simple, testable et réversible").

### 2. `userClubId` dérivé du JWT, jamais hardcodé

`userclub-resolver.ts` décode le payload du JWT obtenu au login et utilise son claim `id` comme source de vérité, avec repli sur `DOINSPORT_USERCLUB_ID` (`.env`) uniquement si le JWT n'en contient pas. Une divergence entre les deux est loggée (`LegacyUserClubIdMismatch`) mais ne bloque jamais l'opération — le JWT fait foi (CDC §13.1). **Validé en conditions réelles** : la divergence documentée dans `API-CATALOG.md` (JWT `b6da0fcf-...` vs `.env` `2aecf357-...`) a été reproduite et gérée correctement lors du test live de cette session. Point V-008 du CDC résolu.

### 3. Résolveur de prix : logique pure, séparée de l'accès réseau

`pricing-resolver.ts` porte l'algorithme exact audité (blocs triés par `createdAt` décroissant, repli sur bloc plus ancien si la durée demandée n'est pas disponible) comme fonction **pure**, prenant des blocs/prix déjà récupérés en entrée. L'adapter (`legacy-doinsport.adapter.ts`) se charge seul de l'accès réseau. Conséquence directe : le port est testable par fixtures sans jamais toucher le réseau (`pricing-resolver.test.ts`), tout en restant validable en direct (fait lors de cette session : le cas réel documenté "Padel 3, 90 min à 11h → 9,00 €/participant" a été reproduit à l'identique).

### 4. Mapping d'erreurs centralisé, jamais de payload Legacy brut

`legacy-errors.ts` traduit chaque erreur Doinsport (statut HTTP + corps) en `AppError` du domaine (CDC §87), avec un cas spécial pour le 422 "créneau occupé" → `BOOKING_SLOT_UNAVAILABLE` (§13.7). Toutes les méthodes publiques de l'adapter passent par `withLegacyErrorMapping()` : aucune `LegacyApiError` (ni son corps brut) ne peut s'échapper du module.

### 5. Terrain local dans les DTOs publics, jamais l'ID Legacy

`LegacyPriceInput`/`LegacyCreateBooking` prennent un `courtId` **local** (`courts.id`), pas un `playgroundId` Doinsport — l'adapter résout lui-même le mapping. Ainsi le futur module `bookings` (Lot 3) n'aura jamais besoin de connaître un identifiant Legacy pour appeler l'adapter (CDC §2.5).

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Réécrire `doinsport.js` from scratch sans porter l'algorithme audité | Interdit par CDC §72 ; risque de réintroduire des bugs déjà corrigés (ex. repli sur bloc plus ancien) |
| Coupler `resolveLegacyPrice` directement aux appels HTTP (une seule fonction) | Rendrait impossible tout test sans réseau ; violerait la testabilité exigée (§112) |
| `legacy_user_mapping` et `legacy_clients` comme deux tables séparées (fidèle au CDC section par section) | Redondance actée comme non intentionnelle après relecture croisée §14/§45 ; simplifiée en une seule table |
| Exposer directement `playgroundId` Legacy dans les DTOs publics de l'adapter | Aurait fuité un identifiant Legacy dans le futur module `bookings`, contraire à CDC §2.5 |

## Conséquences

**Positif :**
- Validé en conditions réelles dès le Lot 2 (authentification, listing terrains, résolution de prix), pas seulement par tests unitaires.
- Aucune structure Doinsport ne fuit hors du module (vérifié par lecture du code des autres modules : aucun import de `legacy-doinsport` en dehors de ses propres fichiers à ce stade).
- Le point V-008 (CDC §100) est résolu et documenté, pas laissé en hypothèse silencieuse.

**Négatif / dette assumée :**
- La synchronisation périodique (polling, CDC §15) et la réconciliation (§49) ne sont **pas** couvertes par ce lot — elles dépendent de l'infrastructure de jobs (pg-boss) qui n'existe pas encore. À couvrir explicitement quand cette infrastructure sera introduite.
- Le mécanisme complet d'idempotence après timeout (recherche du marqueur `APV2:<uuid>` dans les réservations Legacy existantes, CDC §16.2) n'est pas encore implémenté — seul le champ `correlationMarker` est déjà propagé jusqu'au `comment` Doinsport. ADR-0006 reste donc "Proposé".
- `createBooking`/`cancelBooking` n'ont pas été testés en écriture réelle dans cette session (risque sur les données de production du club) — seules les opérations en lecture (`authenticateClub`, `listCourts`, `resolveLegacyPrice`) ont été validées en direct. Les tests d'écriture réels restent à faire prudemment (CDC §94) avant le pilote.
