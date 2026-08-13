# Catalogue API Doinsport — Ardenne Padel

Recense les endpoints de l'API back-office Doinsport (`api-principale.doinsport.club`) réellement
utilisés ou testés depuis ce projet, avec leur statut de validation.

Statuts utilisés :
- **CONFIRMÉ** : testé avec succès (code 2xx observé), en production dans ce repo.
- **REPRODUIT** : capturé via HAR sur une action UI réelle, puis rejoué avec succès via script.
- **OBSERVÉ** : capturé via HAR ou réponse API, non rejoué.

Toutes les valeurs d'exemple (IDs client, noms, téléphones) ci-dessous sont fictives ou masquées
(`<REDACTED>`). Aucun secret (mot de passe, token) n'est stocké dans ce fichier — ils vivent
uniquement dans `.env` (gitignoré) et dans la table SQLite `auth_tokens`.

---

## Authentification

### API-AUTH-01 — Login club (obtention du Bearer)
**Statut** : CONFIRMÉ
**Fichier** : `refresh-doin-token.js`, `doinsport.js` (`refreshTokenFromEnv`)

```
POST https://api-principale.doinsport.club/club_login_check
Content-Type: application/json

{ "username": "<DOINSPORT_USER>", "password": "<DOINSPORT_PASS>" }
```

**Réponse (200)** :
```json
{ "token": "<JWT>" }
```

Le JWT contient `roles: ["ROLE_USER", "ROLE_CLUB"]`, `id` (userClub), `username`, `firstName`,
`lastName`. Durée de vie courte (~1h, `iat`/`exp` dans le payload) — d'où le refresh systématique
avant chaque campagne de tests (`node refresh-doin-token.js`).

Toutes les requêtes suivantes utilisent ce token en header :
```
Authorization: Bearer <token>
```
Le token est stocké dans la table SQLite `auth_tokens` (dernier en date = utilisé) et recopié dans
`.env` (`DOINSPORT_BEARER`) pour inspection manuelle.

Sur 401, `doinsport.js` retente automatiquement un refresh puis rejoue l'appel une fois
(`call()` → `_retry`).

---

## Lecture

### API-READ-01 — Liste des réservations (light)
**Statut** : CONFIRMÉ
**Fonction** : `getBookings(fromISO, toISO, status)` dans `doinsport.js`

```
GET /clubs/bookings/listing
  ?club.id={CLUB_ID}
  &itemsPerPage=200&page=1
  &canceled=true&confirmed=true&getTotalItems=true
  &filter[status]=before|after
  &order[booking.startAt]=asc|desc
  &startAt[after]={fromISO}&startAt[before]={toISO}
```

Pagination gérée automatiquement (boucle sur `page` jusqu'à couvrir `totalItems`). **Note** :
l'endpoint ignore en pratique `startAt[after]`/`startAt[before]` — le filtrage par fenêtre de dates
est donc réappliqué côté client après réception (voir commentaire dans le code).

Objets retournés : légers (id, startAt, canceledAt, ...), pas le détail complet.

### API-READ-02 — Détail d'une réservation
**Statut** : CONFIRMÉ
**Fonction** : `getBooking(id)` dans `doinsport.js`

```
GET /clubs/bookings/{id}
```

Réponse complète : `playgrounds`, `client`, `participants[]` (avec `client` imbriqué par
participant), `activity`, `timetableBlockPrice`, `payments[]`, `accessCodes[]`
(`{ playgroundName, accessCodeEnabledBefore, code }`), `price`, `creationOrigin`, `paymentMethod`,
`confirmed`, `canceled`, `canceledAt`, etc.

### API-READ-03 — Liste des clients du club (fiche client)
**Statut** : CONFIRMÉ
**Fonction** : `getClients()` dans `doinsport.js`

```
GET /clubs/clients?club.id={CLUB_ID}&itemsPerPage=200&page=1&getTotalItems=true
```

Pagination automatique. `normalizeClientContact()` extrait : `id`, `firstName`, `lastName`,
`email`, `gsm` (essaie plusieurs alias : `phoneNumber`/`phone`/`mobile`/`gsm`), `raw` (objet
complet non normalisé).

### API-READ-04 — Export CSV des réservations
**Statut** : CONFIRMÉ
**Fonction** : `getBookingsExport(fromISO, toISO)` dans `doinsport.js`

```
GET /clubs/bookings.export?club.id={CLUB_ID}&order[startAt]=asc&startAt[after]={fromISO}&startAt[before]={toISO}
Accept: text/csv,application/json
```

Réponse : CSV (séparateur `;`), parsé manuellement en objets `{ id, court_key, name, startAt,
endAt, priceCents, paymentsReceived, restToPay, canceled, playground, createdAt, raw }`.

### API-READ-05 — Détail d'un terrain (terrains + grille tarifaire imbriquée)
**Statut** : OBSERVÉ (capturé via HAR, non encore encapsulé dans une fonction)

```
GET /clubs/playgrounds/{playgroundId}
GET /clubs/playgrounds?club.id={CLUB_ID}&itemsPerPage=10&page=1
```

Réponse : objet `ClubPlayground` avec `activities[]` (l'activité associée au terrain) et
`timetables[]` → `blocks[]` → `prices[]` (liste d'IRI vers des `ClubPlaygroundTimetableBlockPrice`,
sans le détail — juste les références).

### API-READ-06 — Lookup dynamique des tarifs par terrain
**Statut** : OBSERVÉ (capturé via HAR — c'est l'endpoint qui manquait pour résoudre
`timetableBlockPriceId` sans coder les IDs en dur)

```
GET /clubs/playgrounds/timetables/blocks/prices
  ?playground.id={playgroundId}
  &activity.id[]={activityId}
  &itemsPerPage=200&page=1
```

Réponse : collection Hydra de `ClubPlaygroundTimetableBlockPrice` complets — `name`,
`pricePerParticipant` (centimes), `duration` (secondes), `maxParticipantsCountLimit`, `activity`,
`nextoreProductReference`. C'est la requête à faire côté V2 pour résoudre dynamiquement le bon
`timetableBlockPriceId` à partir de (terrain, durée souhaitée, éventuellement bande horaire), plutôt
que de coder les ~27 IDs en dur.

### API-READ-07 — Détail d'un bloc horaire (résout enfin le mapping heure → tarif)
**Statut** : CONFIRMÉ (capturé via HAR le 2026-08-12 en observant l'écran "Formules du jour", puis
implémenté et testé avec succès en conditions réelles)
**Fonction** : `resolveTimetableBlockPrice({ playgroundId, activityId, startAt, durationSeconds })`
dans `doinsport.js` — utilisée automatiquement par `createBooking()` quand `timetableBlockPriceId`
n'est pas fourni explicitement.

```
GET /clubs/playgrounds/timetables?club.id={CLUB_ID}&itemsPerPage=10&page=1&playgrounds.id={playgroundId}
GET /clubs/playgrounds/timetables/blocks/{blockId}
GET /clubs/playgrounds/timetables/blocks?itemsPerPage=500&timetable.id[]={id1}&timetable.id[]={id2}...
```

**Réponse d'un bloc** (`ClubPlaygroundTimetableBlock`) :
```json
{
  "name": "08:00 - 13:00",
  "startAt": "1970-01-01T08:00:00+00:00",
  "endAt": "1970-01-01T13:00:00+00:00",
  "timetable": "/clubs/playgrounds/timetables/{timetableId}",
  "prices": ["/clubs/playgrounds/timetables/blocks/prices/{id}", "..."]
}
```

`startAt`/`endAt` utilisent une date fixe arbitraire (`1970-01-01`) — seule l'heure compte, c'est une
plage horaire **récurrente quotidienne**, pas une date précise. `prices[]` liste les
`timetableBlockPriceId` valides pour ce créneau + ce terrain.

**C'est la pièce manquante identifiée précédemment** : pour résoudre dynamiquement le
`timetableBlockPriceId` à passer à `createBooking()`, il faut :
1. Récupérer les timetables du terrain visé (`GET .../timetables?...&playgrounds.id={id}`) ;
2. Pour chacune, récupérer ses blocks et leurs plages `startAt`/`endAt` ;
3. Trouver le bloc dont la plage englobe l'heure de la réservation souhaitée ;
4. Parmi les `prices[]` de ce bloc, choisir celui dont la `duration` correspond à la durée voulue
   (résolue via API-READ-06).

**Exemple observé — terrain Padel 3, timetable "Padel" (`1f970248-2f2c-4f5e-9005-793e1b09ee34`)**,
4 blocs consécutifs couvrant la journée :
| Plage horaire | Bloc ID | Tarifs associés (extrait) |
|---|---|---|
| 08:00–13:00 | `2398e936-...` | 30'/1H/1H30/2H "HC", + 30' "HM" |
| 13:00–16:00 | `eb8ec5f5-...` | 30'/1H/1H30/2H "HC" |
| 16:00–17:30 | `871966ef-...` | 1H30 "HM" |
| 17:30–23:30 | `95c43ffc-...` | 1H/1H30/2H "HM"/"HP" |

**Point important — plusieurs grilles tarifaires coexistent pour le même terrain**, sélectionnées
apparemment par contexte (offre en cours, mode de paiement) plutôt que par l'heure seule :
- Timetable **"Padel"** (`1f970248-...`) — grille normale, 4 blocs ci-dessus.
- Timetable **"Offre de lancement"** (`3806ddd1-...`) — un seul bloc **10:00–22:00**, mais avec
  `"paymentMethods": ["on_the_spot"]` uniquement (les autres blocs acceptent `"complete"` et
  `"per_participant"`, jamais `"on_the_spot"` seul).
- Timetable **"PROMO Padel Double"** (`a2bbfc66-...`) — 3 blocs (08:00–17:00 HC, 17:00–18:30 HP,
  18:30–23:00 HP) sur des tarifs promo dédiés.

Cette dernière observation explique le champ `paymentMethod: "on_the_spot"` qui a permis à
`createBooking()` de fonctionner (API-WRITE-01) : ce mode n'est valide que sur les blocs de la
timetable "Offre de lancement".

**Règle de priorité entre grilles qui se chevauchent** (confirmée manuellement) : les timetables sont
créées successivement dans le temps et couvrent chacune une période donnée. **Quand deux timetables
couvrent la même période, c'est la plus récemment créée qui prévaut.** Concrètement, pour résoudre
le bon bloc/tarif à une heure donnée : parmi tous les blocks de toutes les timetables du terrain dont
la plage `[startAt, endAt]` couvre l'heure visée, prendre celui dont le **`createdAt` est le plus
récent** (pas le `createdAt` de la timetable parente — la donnée fiable est au niveau du bloc,
voir les exemples ci-dessus où des blocks d'une même timetable "Padel" ont des `createdAt` très
différents : `2025-09-14` pour certains, `2026-05-07`/`2026-05-26` pour d'autres, ce qui montre que
les blocks sont eux-mêmes modifiés/recréés indépendamment).

**Implémenté et testé** dans `resolveTimetableBlockPrice()` : les blocs couvrant l'heure visée sont
triés par `createdAt` décroissant, puis testés un par un jusqu'à trouver celui qui propose un tarif
de la durée demandée — repli nécessaire en pratique : le bloc le plus récent sur un horaire donné
n'a pas forcément de tarif pour toutes les durées (ex. un bloc promo à durée fixe 90 min ne peut pas
servir une réservation d'1h, on retombe alors sur le bloc suivant par ancienneté).

**Tests réels effectués (2026-08-12, Padel 3)** :
| Horaire demandé | Durée | Bloc retenu | Tarif résolu |
|---|---|---|---|
| 11h locale | 1h30 (5400s) | 08:00-13:00 | 1H30 Padel HC (9,00 €/participant) |
| 20h locale | 1h (3600s) | 10:00-22:00 ("Offre de lancement", repli depuis le bloc 18:30-23:00 qui n'avait que du 90 min) | 1H Padel HP (8,00 €/participant) |

Le second cas a aussi été testé en bout en bout via `createBooking()` sans `timetableBlockPriceId`
fourni : réservation créée (`201`, prix total 32,00 € = 8 €×4 participants max, cohérent), puis
annulée proprement. Cycle complet validé.

---

## Écriture

### API-WRITE-01 — Création d'une réservation
**Statut** : CONFIRMÉ (`201 Created` reproduit à plusieurs reprises, y compris via `createBooking()`
avec résolution automatique du tarif, cycle create→cancel validé sans état incohérent — 2026-08-12)
**Fonction** : `createBooking(params)` dans `doinsport.js` — résout automatiquement `activityId`
(via `ACTIVITY_MAP`) et `timetableBlockPriceId` (via `resolveTimetableBlockPrice()`) si non fournis.

```
POST /clubs/bookings
Content-Type: application/json
```

> **Bug corrigé** : le helper `call()` n'envoyait pas `Content-Type: application/json` sur les
> requêtes avec body, ce qui faisait échouer `createBooking`/`cancelBooking` en `415 Unsupported
> Media Type` dès qu'on passait par ce chemin de code (les tests précédents utilisaient un `fetch()`
> manuel qui fixait déjà l'en-tête, d'où l'absence de symptôme jusqu'ici). Corrigé le 2026-08-12.

**Payload** (toutes les références sont des IRI API Platform, pas des objets imbriqués — sinon
`400 Bad Request: "Nested documents ... not allowed. Use IRIs instead."`) :

```json
{
  "id": null,
  "name": "<optionnel>",
  "startAt": "2026-12-31T10:00:00Z",
  "endAt": "2026-12-31T11:30:00Z",
  "activity": "/activities/{activityId}",
  "category": null,
  "timetableBlockPrice": "/clubs/playgrounds/timetables/blocks/prices/{timetableBlockPriceId}",
  "participants": [
    {
      "client": "/clubs/clients/{clientId}",
      "subscriptionCard": null,
      "category": null,
      "inQueue": false,
      "bookingOwner": true
    }
  ],
  "comment": "",
  "clientNote": null,
  "playgrounds": ["/clubs/playgrounds/{playgroundId}"],
  "recurrence": null,
  "fromRecurrence": null,
  "participantsQueueEnabled": false,
  "client": null,
  "club": "/clubs/{CLUB_ID}",
  "creationOrigin": "administration",
  "paymentMethod": "on_the_spot",
  "playgroundOptions": [],
  "nameManuallyUpdated": null,
  "coachVisibleOnline": null,
  "minAgeLimitation": null,
  "maxAgeLimitation": null,
  "userClub": "/user-clubs/{userClubId}"
}
```

**Champs obligatoires découverts par élimination** (leur absence provoque un `500 Internal Server
Error` non explicite, pas un `422` propre) :
- `activity` (IRI) — **dépend du terrain** : `/activities/782d895f-...` ("Padel simple") pour les
  terrains 1 et 2, `/activities/ce8c306e-...` ("Padel") pour les terrains 3 et 4. Voir la table des
  identifiants métier plus bas.
- `timetableBlockPrice` (IRI) — dépend du terrain **et** de la durée/bande horaire (HP/HC/HM, voir
  la table complète des tarifs plus bas). Une mauvaise correspondance créneau/bloc n'a pas été
  testée à fond — à vérifier avant usage en prod.
- `participants[].client` (IRI vers une fiche client existante)
- `userClub` (IRI vers le compte club qui crée la réservation)

**Réponse (201)** : l'objet réservation complet (même schéma que API-READ-02), avec `@id` = nouvel
identifiant.

**Couplage paiement** (répond à la question P0 de l'audit) : `paymentMethod: "on_the_spot"` permet
de créer une réservation confirmée **sans paiement Doinsport/Stripe préalable**. Aucune vérification
de paiement bloquante observée à la création.

**Erreurs observées** :
| Cas | Code | Détail |
|---|---|---|
| Rôle insuffisant sur le token utilisé | 403 | `"Vous n'avez pas les droits nécessaires pour effectuer cette action."` (observé une fois avec un payload minimal — cause exacte non isolée : possiblement lié à des champs manquants plutôt qu'au rôle, voir ci-dessous) |
| Champs obligatoires manquants (`activity`, `timetableBlockPrice`, `participants[].client`, `userClub`) | 500 | Page d'erreur HTML générique, pas de détail exploitable |
| Créneau/terrain déjà occupé | 422 | `{ "violations": [{ "propertyPath": "playgrounds", "message": "Le terrain : {nom} n'est pas disponible." }] }` — message directement utilisable pour l'UI V2 |
| Références en objets imbriqués au lieu d'IRI | 400 | `"Nested documents for attribute \"X\" are not allowed. Use IRIs instead."` |
| IRI mal formée | 400 | `"Invalid IRI \"...\"."` |

> **Non résolu** : le premier test (payload minimal, sans `activity`/`timetableBlockPrice`/
> `participants`/`userClub`) a renvoyé un **403**, alors qu'un test ultérieur avec le même compte
> mais un payload plus complet a renvoyé un **500** puis, une fois complet, un **201**. Il n'est pas
> certain que le 403 initial soit dû aux droits du compte ou à la combinaison de champs manquants.
> Le compte `a.zingaro` (`ROLE_CLUB`) crée bien des réservations avec succès une fois le payload
> complet — donc **le rôle n'est pas bloquant** dans le cas nominal documenté ici.

### API-WRITE-02 — Annulation d'une réservation
**Statut** : REPRODUIT (capturé via HAR, rejoué avec succès via script — `200` confirmé le
2026-08-12, cycle create→cancel→create validé sans état incohérent)
**Fonction** : `cancelBooking(bookingId, { withRefund })` dans `doinsport.js`

```
PUT /clubs/bookings/{bookingId}
Content-Type: application/json

{ "canceled": true, "withRefund": true }
```

**Réponse (200)** : objet réservation complet avec `canceled: true`, `canceledAt: <ISO>`.

Libère immédiatement le créneau (vérifié : une recréation sur le même horaire juste après
l'annulation a réussi, `201`).

---

## Identifiants métier connus

| Nom | Valeur | Rôle |
|---|---|---|
| Club (Ardenne Padel) | `bc00e362-49b4-4f08-b10f-fc1bf4bdeed8` | `DOINSPORT_CLUB_ID` — utilisé dans quasi tous les appels |
| UserClub (a.zingaro) | `2aecf357-d1f4-4f5d-9500-94e7ac94a5cc`* | `DOINSPORT_USERCLUB_ID` — requis pour `createBooking` (`userClub`) |
| Activité "Padel simple" | `782d895f-9257-4f1a-ac80-20558f067411` | terrains **1 et 2** (simple) |
| Activité "Padel" | `ce8c306e-224a-4f24-aa9d-6500580924dc` | terrains **3 et 4** (double) |

*Valeur telle que présente dans `.env` au moment de la rédaction — à re-vérifier si le token
`userClub.id` du JWT diverge (le JWT observé lors des tests contenait un `id` différent,
`b6da0fcf-...` ; les deux valeurs semblent désigner le même compte club mais l'origine de l'écart
n'a pas été creusée).

### Terrains (`COURT_MAP` dans `court-map.js`)
| ID Doinsport | Nom |
|---|---|
| `299a4ddb-1e78-4f19-832a-263a4c0dc36e` | Padel 1 |
| `ad93e11b-bf96-4fe1-abc9-214613a2c0b2` | Padel 2 |
| `8b2481f8-abd3-4ffa-8b6a-f628220472fe` | Padel 3 |
| `ece8e815-8142-4feb-a0a3-a32d4d49f82c` | Padel 4 |

### Tarifs horaires (`timetableBlockPrice`)

Capturés via API-READ-06 le 2026-08-12. **HP** = heures pleines, **HC** = heures creuses, **HM** =
probablement "heures médianes" (bande intermédiaire, non confirmé — nom déduit du sigle, pas d'un
libellé explicite vu dans l'UI). Prix en €/participant (le prix total = `pricePerParticipant ×
maxParticipantsCountLimit`).

**Terrains 1 et 2 (Padel simple, activité `782d895f-...`)** :
| ID | Nom | Prix/participant | Durée |
|---|---|---|---|
| `39269eab-f08f-4f6d-a9d7-7f2c7713b321` | 1H30 Padel HC | 18,00 € | 90 min |
| `69319b20-bee2-4faa-a1f6-d3390d4506e5` | 30' Padel HC | 6,00 € | 30 min |
| `846f0f09-78f2-4f3a-86cf-a0d4ef2351b5` | 1H Padel HC | 12,00 € | 60 min |
| `ecedbcc4-5118-4f7d-ad7a-ebdd596acc40` | 2H Padel HC | 24,00 € | 120 min |
| `07a87a85-1dce-4fb4-9862-2be7fb6d0cc9` | PROMO Padel Simple - 60' - 20€ | 10,00 € | 60 min |

> Seuls des blocs "HC" ont été capturés pour les terrains simples dans ce HAR — pas de "HP"/"HM"
> observé pour Padel 1/2. À vérifier si ces terrains n'ont réellement qu'un seul tarif, ou si
> d'autres blocs existent mais n'ont pas été affichés lors de la capture.

**Terrains 3 et 4 (Padel double, activité `ce8c306e-...`)** — les deux terrains référencent
exactement le même catalogue de tarifs (prix définis au niveau club, pas par terrain individuel) :
| ID | Nom | Prix/participant | Durée |
|---|---|---|---|
| `bfcc7244-e38f-4ff8-8cfa-02b36797651e` | 30' Padel HC | 3,00 € | 30 min |
| `c0e83259-7890-4f64-8680-1097eb1e1d60` | 30' Padel HP | 4,00 € | 30 min |
| `533ba17b-541a-4f0e-aeb2-bfb354d4afb9` | 30' Padel HM | 3,50 € | 30 min |
| `1ca0a469-8a34-4ffd-9396-af898e599808` | 1H Padel HC | 6,00 € | 60 min |
| `eac2c0e3-48c7-4fa9-843f-cfdd6abbe150` | 1H Padel HP | 8,00 € | 60 min |
| `4bc57b29-6c9d-4fb3-b4da-506617c5ea8e` | 1H Padel HM | 7,00 € | 60 min |
| `7f1eb8f2-fb50-4f91-8c55-f600383c0694` | 1H30 Padel HC | 9,00 € | 90 min |
| `ea53e75e-3adf-4f05-96c0-091701ffe527` | 1H30 Padel HP | 12,00 € | 90 min |
| `21534b28-16e8-4f30-a095-c6f26f78a39c` | 1H30 Padel HM | 10,50 € | 90 min |
| `0cf35647-d050-4f85-aa38-baa33430744b` | 2H Padel HC | 12,00 € | 120 min |
| `384b5b9f-8ffc-4fa2-9516-90eb7d1cb960` | 2H Padel HP | 16,00 € | 120 min |
| `2db1f3b8-09d6-4f34-b416-6c1af721cdcc` | 2H Padel HM | 14,00 € | 120 min |
| `0ab48f5f-93f1-4f2c-b943-8442cf1ad611` | PROMO Padel Double HP - 90' - 40€ | 10,00 € | 90 min |
| `ffded764-ee69-4ff2-903b-92d6f53efe92` | PROMO Padel Double HC - 90' - 30€ | 7,50 € | 90 min |
| `735f0dfc-0efd-4f62-94a9-cf4f92e192b0` | 1H30 Offre de lancement | 0,00 € | 90 min |
| `02f3ab7e-9de2-4fbc-9079-2d7579479702` | (référencé mais détail non capturé) | — | — |

> Le mapping bande horaire (HP/HC/HM) → heure de la journée n'a **pas** été capturé — l'UI l'applique
> automatiquement selon `startAt`, mais rien dans ces réponses ne donne les bornes horaires
> associées à HP/HC/HM. À déterminer avant que `createBooking` puisse choisir seul le bon tarif :
> soit trouver l'endpoint qui expose ces règles, soit les configurer manuellement côté V2.

**Comment résoudre `timetableBlockPriceId` dynamiquement** : appeler API-READ-06 avec le `playgroundId`
et l'`activityId` du terrain visé, puis filtrer côté client sur `duration` (secondes) — et sur le nom
(HP/HC/HM) une fois la règle horaire déterminée.

---

## Non couvert par ce catalogue

Les points suivants de l'audit initial n'ont **pas** été investigués et restent NON DÉTERMINÉ :
- Concurrence / verrouillage de créneau (deux créations simultanées sur le même horaire)
- Idempotence (rejouer exactement la même requête `POST /clubs/bookings` après un timeout)
- Webhooks / synchronisation temps réel (aucun mécanisme identifié à ce stade — probablement
  polling incrémental sur `getBookings`/`getBooking` à défaut d'autre chose)
- Wallet / crédits client
- Codes d'accès : lecture confirmée (`accessCodes[]` dans le détail réservation), génération non
  investiguée
- Recherche de clients (endpoint dédié éventuel autre que `getClients` complet)
- Rate limiting

## Fichiers concernés dans ce projet
- `doinsport.js` — toutes les fonctions d'appel API (lecture + écriture)
- `refresh-doin-token.js` — obtention/rafraîchissement du Bearer
- `court-map.js` — mapping terrain
- `db.js` / `booking-db.js` — persistance locale (SQLite)
- `sync.js` / `sync-all.js` — synchronisation périodique des réservations Doinsport → DB locale
