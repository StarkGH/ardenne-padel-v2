# Protocole Raspberry — Automatisation physique (Phase 1)

Contrat exact entre AP V2 (serveur) et le contrôleur Raspberry (`ardenne-access-01`),
tel qu'implémenté dans `apps/api/src/modules/automation/`. Ce document décrit le code
réellement en place, pas le CDC théorique — en cas de divergence future entre les deux,
ce fichier fait foi côté implémentation et doit être mis à jour dans le même commit que
tout changement de comportement.

**Statut** : Phase 1 (snapshot/heartbeat/ACK/événements) + commandes manuelles
(CDC_APV2_COMMANDES_MANUELLES_RASPBERRY_LOGO). Testé en dev local (WSL) le 2026-09-10,
transport HTTP validé de bout en bout (auth, snapshot, ETag/304, heartbeat, commandes
device-ciblées avec ACK SUCCESS/FAILED, événements), y compris en navigateur réel sur le
back-office (`/admin/automation`). **Validé sur le POC matériel réel** le même jour via
`raspberry_bridge.py` (WSL, sur le même réseau que le LOGO!, `192.168.0.3:503`) : les 4
commandes (`DOOR_OPEN`, `DOOR_CLOSE`, `LIGHT_ON`, `LIGHT_OFF`) pulsent réellement les coils
M2/M3/M4/M1 correspondants et retournent un ACK `SUCCESS`. Ce script bench-teste depuis un
PC ayant accès au réseau du LOGO! — le vrai Raspberry `ardenne-access-01` n'exécute pas
encore ce pont lui-même (portage direct : mêmes appels HTTP, même `LogoDriver`).

**Flag** : `ACCESS_DEVICE_SYNC_ENABLED` (défaut `false`). Tant qu'il est à `false`, tous
les endpoints `/devices/automation/*` répondent `503` sans authentifier quoi que ce soit.

---

## 1. Vue d'ensemble

```text
Raspberry (client)
   │  HTTPS + Bearer <deviceKey>
   ▼
AP V2 — /api/v1/devices/automation/*
   │
   ├── GET  /snapshot           poll périodique (recommandé : 15-30 s)
   ├── POST /heartbeat          après chaque poll
   ├── POST /commands/:id/ack   après exécution physique réussie d'une commande
   └── POST /events             remontée d'événements (accès accordé/refusé, etc.)
```

Le serveur ne connaît jamais le mapping matériel (Modbus/LOGO!, Wiegand, ports série) —
il expose uniquement des zones logiques, des codes d'accès déchiffrés, des intervalles
d'éclairage calculés, et une file de commandes MVP. Toute décision de bas niveau reste
locale au Raspberry.

---

## 2. Authentification

- **Mécanisme** : clé opaque (32 octets, base64url), transmise en clair **une seule fois**
  à la création (`POST /admin/automation-devices`), jamais stockée en clair côté serveur
  (seul son hash SHA-256 l'est — `apps/api/src/modules/identity/tokens.ts`).
- **Header** : `Authorization: Bearer <deviceKey>` sur **tous** les endpoints `/devices/automation/*`.
- **Pas de session, pas de cookie.** Un device authentifié n'est jamais un utilisateur
  (CDC §22.6, même logique que les kiosques).
- Un device révoqué (`POST /admin/automation-devices/:id/revoke`) reçoit `401` sur
  tout appel ultérieur, immédiatement (pas de cache de validité côté serveur).

```
Authorization: Bearer pDKNjiJLMrYKW6KIEtprG1ggRS8o2tHjtbicP4oYBx4
```

---

## 3. `GET /api/v1/devices/automation/snapshot`

### Requête

```
GET /api/v1/devices/automation/snapshot HTTP/1.1
Authorization: Bearer <deviceKey>
If-None-Match: <revision précédente>   (optionnel)
```

`If-None-Match` est une simple égalité de chaîne sur `revision` — ce n'est pas un ETag
HTTP faible/fort au sens RFC, juste une comparaison de hash applicatif portée par le même
header pour rester compatible avec les clients HTTP standards.

### Réponse — contenu inchangé

```
HTTP/1.1 304 Not Modified
ETag: <revision inchangée>
```

Corps vide. Le Raspberry doit réutiliser **son propre cache local** (zones, grants,
lightIntervals, commands du dernier `200`) — un `304` ne renvoie jamais le contenu.

### Réponse — contenu neuf ou modifié

```
HTTP/1.1 200 OK
ETag: <revision>
Content-Type: application/json
```

```json
{
  "data": {
    "revision": "873dbd3049d4e0ac12ad6de071af6c4f99dfba1d183a5e7642c218aa8d91830a",
    "generatedAt": "2026-09-10T13:51:34.527Z",
    "zones": [
      { "key": "a446f342-e19f-46e7-8dc2-1849fdab22a2", "type": "GENERIC", "label": "Padel 1 - accès", "courtId": "a446f342-e19f-46e7-8dc2-1849fdab22a2" },
      { "key": "light-a446f342-e19f-46e7-8dc2-1849fdab22a2", "type": "LIGHT", "label": "Padel 1 - éclairage", "courtId": "a446f342-e19f-46e7-8dc2-1849fdab22a2" },
      { "key": "main_entry", "type": "DOOR", "label": "Entrée principale", "courtId": null }
    ],
    "grants": [
      { "scope": "a446f342-e19f-46e7-8dc2-1849fdab22a2", "code": "9465#", "origin": "V2_GENERATED", "validFrom": "2026-09-11T06:45:00.000Z", "validUntil": "2026-09-11T08:15:00.000Z" },
      { "scope": "Padel 1", "code": "9911#", "origin": "LEGACY_IMPORTED", "validFrom": "2026-09-11T09:00:00.000Z", "validUntil": "2026-09-11T10:00:00.000Z" }
    ],
    "lightIntervals": [
      { "zoneKey": "light-a446f342-e19f-46e7-8dc2-1849fdab22a2", "startsAt": "2026-09-11T15:55:00.000Z", "endsAt": "2026-09-11T18:40:00.000Z" }
    ],
    "commands": [
      { "id": "56bf74ec-1055-4e57-90d1-adcf7e1d2ac4", "zoneKey": null, "type": "LIGHT_ON", "createdAt": "2026-09-10T15:51:12.653Z", "expiresAt": "2026-09-10T15:51:42.652Z" }
    ]
  }
}
```

JSON réel obtenu en dev local le 2026-09-10 (identifiants de test, hors production).

### Champs

| Champ | Type | Notes |
|---|---|---|
| `revision` | string (hex sha256) | Hash déterministe de `{zones, grants, lightIntervals, commands}`. Change dès que l'un de ces quatre éléments change. Aucun rapport avec `schemaVersion` (absent pour l'instant — Phase 1 n'a qu'une seule forme de payload ; un `schemaVersion` littéral sera ajouté au premier changement de forme incompatible). |
| `generatedAt` | ISO 8601 UTC | Horodatage de génération, informatif uniquement (ne pas l'utiliser pour la logique de cache — c'est `revision`/`ETag` qui fait foi). |
| `zones[].key` | string | Identifiant stable de la zone, choisi côté back-office. **C'est la clé que le Raspberry utilise pour son mapping local** (`main_entry` → `Q6`, etc. — CDC §37 : ce mapping reste local, le serveur ne le connaît jamais). |
| `zones[].type` | `DOOR \| LIGHT \| GENERIC` | |
| `zones[].courtId` | string uuid ou `null` | Renseigné si la zone est liée à un terrain V2. |
| `grants[].scope` | string | **Piège connu, à respecter absolument** : pour un grant `V2_GENERATED`, `scope` = l'UUID `Court.id`. Pour un grant `LEGACY_IMPORTED`, `scope` = le libellé Doinsport du terrain (`playgroundName`, ex. `"Padel 1"`) **quand Doinsport l'a fourni** — donc une chaîne humaine, pas un UUID. Le serveur résout déjà cette double correspondance avant d'inclure le grant dans le snapshot (voir §7) ; côté Raspberry, il suffit de faire correspondre `grants[].scope` à la zone dont c'est soit la clé, soit le libellé attendu au moment du provisionnement (à documenter localement, hors serveur). |
| `grants[].code` | string `NNNN#` | Le PIN en clair, déchiffré côté serveur juste avant l'envoi (jamais stocké en clair en base — CDC §57.1/§34.4). Ne jamais logger ce champ. |
| `grants[].origin` | `V2_GENERATED \| LEGACY_IMPORTED \| STAFF_MASTER` | Purement informatif pour le Raspberry (debug/audit) — la validation locale du code ne doit pas différer selon l'origine. `STAFF_MASTER` = code maître employé (nominatif, zone par zone, jamais lié à une réservation — géré depuis `/admin/automation`, section "Codes maîtres employés") ; `validUntil` vaut la date d'expiration choisie à la création, ou une date très lointaine (2099) si le code n'expire jamais. |
| `grants[].validFrom` / `validUntil` | ISO 8601 UTC | Fenêtre de validité (inclut déjà les marges `ACCESS_ENABLED_BEFORE/AFTER_MINUTES`). |
| `lightIntervals[].zoneKey` | string | Référence `zones[].key` d'une zone `LIGHT`. |
| `lightIntervals[].startsAt` / `endsAt` | ISO 8601 UTC | Intervalle déjà marginé (`LIGHT_ENABLED_BEFORE/AFTER_MINUTES`) et **fusionné** : deux réservations qui se chevauchent ou se suivent immédiatement après marge ne produisent jamais deux intervalles distincts (voir §8). |
| `commands[].id` | string uuid | À utiliser tel quel dans `POST /commands/:id/ack`. |
| `commands[].zoneKey` | string ou `null` | Référence `zones[].key` pour une commande zone-scopée (future automatisation planifiée). **`null` pour une commande manuelle** (§12) — celle-ci cible directement le device qui l'a récupérée, jamais une zone. |
| `commands[].type` | `DOOR_OPEN \| DOOR_CLOSE \| LIGHT_ON \| LIGHT_OFF` | Liste MVP fermée — jamais de commande bas niveau (aucune adresse Modbus/registre LOGO! ne transite par ce protocole, dossier technique §36/§37). Mapping réel, validé sur le POC matériel le 2026-09-10 (`raspberry_bridge.py`, impulsion ~500 ms — write coil `True` puis `False` après `pulse_seconds`) : `DOOR_OPEN` → M2 (adresse PyModbus zero-based **8257**) ; `DOOR_CLOSE` → M3 (**8258**) ; `LIGHT_ON` → M4 (**8259**) ; `LIGHT_OFF` → M1 (**8256**). Ces adresses sont **entièrement locales au pont Raspberry**, jamais exposées à AP V2 ni au frontend admin — seuls les 4 types de commande métier transitent par ce protocole. |
| `commands[].createdAt` | ISO 8601 UTC | Heure de création de la commande — permet au Raspberry d'appliquer son propre délai de garde en plus de `expiresAt`. |
| `commands[].expiresAt` | ISO 8601 UTC | **Ne jamais exécuter une commande après cette heure**, même si elle apparaît encore dans un snapshot en cache ou arrive en retard sur une connexion lente (CDC §7 : les commandes manuelles expirent en 30 s par défaut, `MANUAL_COMMAND_TTL_SECONDS`). |

Une commande n'apparaît dans `commands[]` que si elle n'a **pas encore été ACKée** et n'a
pas expiré (voir §5). Elle réapparaît à **chaque** appel tant qu'aucun ACK n'est reçu — y
compris après un `200` précédent qui l'avait déjà montrée.

---

## 4. `POST /api/v1/devices/automation/heartbeat`

### Requête

```
POST /api/v1/devices/automation/heartbeat HTTP/1.1
Authorization: Bearer <deviceKey>
Content-Type: application/json

{
  "revision": "873dbd3049d4e0ac12ad6de071af6c4f99dfba1d183a5e7642c218aa8d91830a",
  "uptimeSeconds": 15,
  "nanoConnected": true,
  "logoReachable": true,
  "dbOk": true,
  "pendingEvents": 0,
  "softwareVersion": "simulator-1.0"
}
```

Tous les champs sauf `revision` sont optionnels (chacun documente une santé de composant —
dossier technique §41 : uptime, dernière révision synchronisée, Nano connecté, LOGO!
joignable, DB locale OK, file d'événements non envoyés, version logicielle).

### Réponse

```
HTTP/1.1 204 No Content
```

Le serveur enregistre `lastSeenAt = now()`, `lastSyncRevision = revision`,
`lastHeartbeat = <le JSON envoyé>` — consultables dans le back-office
(`GET /admin/automation-devices`, champ `offline` calculé via
`AUTOMATION_DEVICE_OFFLINE_AFTER_SECONDS`, défaut **30 s**). Ce seuil est le seul utilisé
pour décider si un device est "en ligne" — à la fois pour le badge admin et pour autoriser
ou refuser une commande manuelle (§12) : il n'existe qu'une seule définition d'"en ligne"
dans tout le système. Un Raspberry qui envoie son heartbeat toutes les 15-30 s (recommandé
§10) reste donc "en ligne" sans marge excessive ; un heartbeat moins fréquent que ce seuil
ferait apparaître le device hors ligne entre deux battements, y compris quand il fonctionne
normalement — caler l'intervalle d'envoi sur ce seuil, pas l'inverse.

---

## 5. `POST /api/v1/devices/automation/commands/:id/ack`

### Fiabilité des commandes — le point critique

```text
PENDING   (créée côté back-office, jamais encore renvoyée par /snapshot)
   │
   │  GET /snapshot (200) — la commande apparaît dans commands[]
   ▼
DELIVERED (marqué côté serveur — mais PAS retirée du snapshot pour autant)
   │
   │  tant qu'aucun ACK n'arrive : chaque nouveau GET /snapshot la
   │  redonne, identique, dans commands[] — y compris après un crash/
   │  reboot du Raspberry entre la réception et l'exécution physique
   ▼
   │  POST /commands/:id/ack (après exécution physique réussie)
   ▼
SUCCESS / FAILED  (retirée du snapshot, définitivement — un revision différent
                   est immédiatement visible, voir §6)

Fallback si aucun ACK n'arrive jamais :
DELIVERED → EXPIRED à `expiresAt` — 10 min pour une commande zone-scopée
(`ACCESS_COMMAND_TTL_MINUTES`), **30 s pour une commande manuelle**
(`MANUAL_COMMAND_TTL_SECONDS`, §12) — nettoyage best-effort exécuté au début de chaque
`buildSnapshot`.
```

**SUCCESS et FAILED sont tous les deux terminaux** — la distinction ne porte que sur le
résultat rapporté par le Raspberry (`status` du corps de l'ACK, ci-dessous), jamais sur le
fait que la commande a été traitée. Ni l'un ni l'autre ne prouve un état physique réel :
un ACK `SUCCESS` signifie seulement "le Raspberry a transmis l'ordre au LOGO! sans erreur
locale détectée", jamais "la porte est physiquement ouverte" (aucun capteur de porte à ce
stade — CDC_APV2_COMMANDES_MANUELLES_RASPBERRY_LOGO §15). Même logique pour l'éclairage.

**DELIVERED n'est jamais un état terminal côté serveur.** Recevoir une commande via
`GET /snapshot` ne suffit pas à la faire disparaître — seul un ACK explicite le fait.
C'est délibéré : un Raspberry qui reçoit `OPEN_DOOR_PULSE`, plante avant d'actionner le
relais, puis redémarre, doit retrouver exactement la même commande à son prochain poll.

**Idempotence : à la charge du Raspberry.** Le serveur redélivre la même commande tant
qu'elle n'est pas ACKée — il ne garantit jamais lui-même qu'elle n'a été vue qu'une fois.
Le Raspberry doit donc mémoriser localement les `commandId` déjà exécutés physiquement
(même table SQLite que le cache offline) et ignorer silencieusement une commande dont
l'id a déjà été exécuté, tout en renvoyant quand même l'ACK (au cas où le précédent ACK
se serait perdu en route).

### Requête

```
POST /api/v1/devices/automation/commands/56bf74ec-1055-4e57-90d1-adcf7e1d2ac4/ack HTTP/1.1
Authorization: Bearer <deviceKey>
Content-Type: application/json

{ "status": "SUCCESS" }
```

ou, en cas d'échec local :

```json
{ "status": "FAILED", "error": "LOGO_CONNECTION_FAILED" }
```

`status` est optionnel et vaut `SUCCESS` par défaut (compatibilité avec un appel sans
corps, comme le fait le simulateur de dev actuel) ; `error` est une chaîne libre
(≤ 200 caractères) stockée telle quelle dans `result` — pas d'enum fermé côté serveur,
mais des valeurs indicatives : `LOGO_CONNECTION_FAILED`, `MODBUS_WRITE_FAILED`,
`COMMAND_EXECUTION_FAILED`.

### Réponses

| Code | Cas |
|---|---|
| `204 No Content` | ACK accepté — la commande passe `DELIVERED → SUCCESS` ou `DELIVERED → FAILED` selon `status`. |
| `422 Unprocessable Entity` | Corps invalide (`status` autre que `SUCCESS`/`FAILED`, `error` trop long). |
| `404 Not Found`, code `COMMAND_NOT_FOUND` | Commande inconnue, ou **déjà ACKée** (pas de double-crédit), ou jamais délivrée (encore `PENDING`, donc pas encore `DELIVERED` — l'ACK ne saute jamais l'étape de livraison). |
| `404 Not Found`, code `COMMAND_EXPIRED` | La commande a expiré avant que l'ACK n'arrive (ex. Raspberry hors ligne au moment où elle a été mise en file, ou latence réseau > TTL). Distinct de `COMMAND_NOT_FOUND` pour permettre au Raspberry de logguer précisément "trop tard" plutôt que "inconnue". |

Dans les deux cas `404`, le Raspberry ne doit **pas** retenter automatiquement (ce n'est
jamais une erreur transitoire) — journaliser et passer à autre chose.

Vérifié en direct (dev, 2026-09-10) : `GET` (commande présente) → `GET` sans ACK
(commande **toujours** présente, id identique) → `ACK {"status":"SUCCESS"}` (`204`) →
`GET` (commande absente) → ré-`ACK` sur le même id (`404 COMMAND_NOT_FOUND`). Egalement
vérifié : `ACK {"status":"FAILED","error":"LOGO_CONNECTION_FAILED"}` → statut `FAILED`
et `result` renseigné, visibles depuis `GET /admin/automation-commands/:id` et l'historique
du back-office.

---

## 6. ETag/`revision` et invalidation

`revision` est un hash SHA-256 sur `{zones, grants, lightIntervals, commands}` sérialisés
de façon déterministe. **Toute** modification de l'un de ces éléments change `revision` :

- Une nouvelle commande mise en file (`POST /admin/automation-zones/:key/commands`) fait
  apparaître un nouvel `id` dans `commands[]` → `revision` change immédiatement. Un
  Raspberry qui revient avec l'ancien `If-None-Match` reçoit un `200` complet (jamais un
  `304` à tort), avec la commande dedans.
- Un ACK retire une commande de `commands[]` → `revision` change à nouveau. Un Raspberry
  qui revient avec l'`If-None-Match` "commande présente" reçoit un `200` complet montrant
  qu'elle a disparu — jamais un `304` qui masquerait le changement.
- Un nouveau grant (réservation confirmée), une zone créée/modifiée, ou une nouvelle
  réservation affectant `lightIntervals` produisent le même effet.

Vérifié en direct : queue commande → `revision` après ≠ `revision` avant, avec l'ancien
`If-None-Match` → `200` (pas `304`) ; ACK → nouveau `revision` ≠ précédent, avec
l'`If-None-Match` "commande présente" → `200` (pas `304`) montrant `commands: []`.

Il n'y a **pas** de compteur en mémoire côté serveur : `revision` est recalculé à chaque
requête à partir de l'état réel en base, donc correct même après un redémarrage du
processus API.

---

## 7. Résolution des grants par zone (piège Dual Run)

`AccessGrantService.provisionOrImportForBooking` (module `access`, pas `automation`) fixe
`scope` différemment selon l'origine du code :

- **`V2_GENERATED`** : `scope = booking.courtId` (UUID V2).
- **`LEGACY_IMPORTED`** : `scope = playgroundName` (libellé Doinsport, ex. `"Padel 1"`)
  **si Doinsport l'a fourni**, sinon repli sur `booking.courtId`.

`AutomationService.buildSnapshot` construit donc l'ensemble des scopes à interroger comme
l'union, pour chaque zone active : sa `key`, son `courtId` (si renseigné), **et** le nom
du `Court` lié (`zone.court.name`, si renseigné). Sans cette double correspondance, tous
les grants `LEGACY_IMPORTED` disparaîtraient silencieusement du snapshot — vérifié par un
test dédié (`automation.service.test.ts`, "routes both V2_GENERATED ... and
LEGACY_IMPORTED ... grants") et en conditions réelles (§3, exemple de réponse ci-dessus).

---

## 8. Éclairage — fusion des intervalles

Pour chaque zone `LIGHT` avec un `courtId`, le serveur interroge les réservations du
terrain (table `Booking`, statuts `CONFIRMED`/`COMPLETED`, **et** `LegacyBooking` non
annulées — une lumière doit s'allumer pour toute réservation réelle, quelle que soit son
origine V2/Legacy), applique les marges `LIGHT_ENABLED_BEFORE_MINUTES` (défaut 5) et
`LIGHT_ENABLED_AFTER_MINUTES` (défaut 10) — **sauf si la zone porte sa propre surcharge**
(`lightBeforeMinutes`/`lightAfterMinutes`, éditable par terrain depuis `/admin/automation`,
`PATCH /admin/automation-zones/:id`, `null` = revenir au réglage global) — puis fusionne
tout intervalle qui chevauche ou touche exactement le suivant
(`apps/api/src/modules/automation/light-interval-merger.ts`). Même mécanisme de surcharge
par terrain côté code d'accès (`doorBeforeMinutes`/`doorAfterMinutes` sur une zone `DOOR`
liée à un `courtId`, via `ZoneAccessMarginsAdapter` — module `access`, jamais couplé
directement à `automation`).

Deux réservations consécutives 18h-19h puis 19h-20h ne produisent donc jamais un flicker
OFF/ON à 19h : avec les marges par défaut, `[17:55, 19:10]` et `[18:55, 20:10]` se
chevauchent (18:55 < 19:10) → fusionnés en `[17:55, 20:10]`. Testé unitairement
(`light-interval-merger.test.ts`, 7 cas dont chevauchement, contact exact à la frontière,
intervalle englobé, entrées non triées) et en intégration
(`automation.service.test.ts`, "returns padded, merged light intervals for two
consecutive bookings").

---

## 9. `POST /api/v1/devices/automation/events`

### Requête

```json
{
  "events": [
    { "eventId": "a1b2c3d4-...", "type": "ACCESS_GRANTED", "occurredAt": "2026-09-10T13:50:25.655Z", "payload": { "zoneKey": "main_entry", "code": "9465#" } }
  ]
}
```

- `eventId` : généré côté Raspberry (UUID recommandé), **stable en cas de retry** — c'est
  la clé d'idempotence.
- `type` : chaîne libre côté serveur (pas d'enum fermé pour l'instant — pas de
  contrainte de vocabulaire imposée par ce protocole).
- `occurredAt` : ISO 8601 avec offset (ex. `Z` ou `+02:00`), heure de l'événement réel
  (pas l'heure d'envoi).
- `payload` : objet libre, stocké tel quel (JSON), jamais interprété par le serveur.
- Jusqu'à 200 événements par appel.

### Réponse

```
HTTP/1.1 202 Accepted
```
```json
{ "data": { "accepted": 1, "duplicates": 0 } }
```

**Idempotence garantie côté serveur** (contrainte unique `(deviceId, eventId)`) : renvoyer
deux fois le même `eventId` après un timeout réseau ne crée jamais deux lignes —
`duplicates` compte les rejets silencieux, ce n'est pas une erreur.

---

## 10. Codes HTTP, retry, timeouts

| Code | Signification | Comportement Raspberry attendu |
|---|---|---|
| `200` | Contenu (snapshot) | Traiter, mettre à jour le cache local, `revision` = nouvel `ETag`. |
| `202` | Événements acceptés (dont doublons) | Retirer de la queue locale d'événements en attente. |
| `204` | Heartbeat/ACK acceptés | Rien à faire. |
| `304` | Snapshot inchangé | Réutiliser le cache local tel quel. |
| `401` | Clé invalide/révoquée | **Ne pas retenter en boucle.** Alerter (heartbeat local visible en façade si possible), attendre une ré-provision manuelle (nouvelle clé via le back-office). |
| `404` (sur `/ack`), `COMMAND_NOT_FOUND`/`COMMAND_EXPIRED` | Commande déjà ACKée/jamais délivrée/expirée (§5) | Ne pas retenter — journaliser et continuer. |
| `422` | Payload invalide (bug client) | Ne pas retenter tel quel — corriger le payload. |
| `503` | `ACCESS_DEVICE_SYNC_ENABLED=false` côté serveur | Continuer à fonctionner en mode offline avec le dernier cache connu ; retenter périodiquement. |
| Erreur réseau / timeout | — | Retry avec backoff, voir ci-dessous. Ne jamais bloquer la validation locale d'un code déjà en cache (dossier technique §40). |

**Timeouts recommandés** (non imposés par le serveur, valeurs de départ raisonnables pour
un Raspberry sur réseau local avec sortie Internet) :
- `GET /snapshot`, `POST /heartbeat` : timeout 10 s, poll toutes les 15-30 s.
- `POST /commands/:id/ack` : timeout 10 s, retry immédiat une fois puis laisser le
  prochain cycle de snapshot représenter la commande (elle est toujours là tant qu'elle
  n'est pas ACKée — pas d'urgence à bloquer sur l'ACK).
- `POST /events` : timeout 10 s, backoff exponentiel (1s, 2s, 4s, ... plafonné ~60s) en
  cas d'échec réseau, les événements restent en queue locale (jamais perdus) jusqu'à
  envoi réussi.

**Format des timestamps** : ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`) partout en sortie
serveur (`generatedAt`, `validFrom`/`validUntil`, `startsAt`/`endsAt`). En entrée
(`heartbeat.revision` mis à part, qui est le hash opaque), `events[].occurredAt` accepte
tout ISO 8601 avec offset explicite.

---

## 12. Commandes manuelles (back-office → Raspberry)

CDC_APV2_COMMANDES_MANUELLES_RASPBERRY_LOGO. Le pilotage manuel (bouton admin) réutilise
intégralement le protocole ci-dessus — **aucun second mécanisme, aucune connexion
entrante vers le Raspberry**. Seule différence avec une commande zone-scopée : elle cible
directement un `deviceId` (`zoneKey: null` dans le snapshot), pas une zone, puisqu'un seul
Raspberry pilote toute l'automatisation du club (porte + éclairage).

### Endpoints admin (jamais appelés par le Raspberry)

```http
POST /api/v1/admin/automation-devices/:deviceId/commands
Cookie: <session ADMIN>
Content-Type: application/json

{ "type": "DOOR_OPEN" }
```

Réservé aux utilisateurs `ADMIN` (plus strict que `STAFF`, utilisé par les commandes
zone-scopées — porte/éclairage sont sensibles, CDC_APV2_COMMANDES_MANUELLES_RASPBERRY_LOGO
§12). Contrôles serveur, dans l'ordre, avant toute création :

1. session authentifiée + rôle `ADMIN` (`requireAuth` + `requireRole("ADMIN")`) ;
2. `deviceId` existe et son statut est `ACTIVE` — sinon `404 DEVICE_NOT_FOUND` ;
3. le device est en ligne selon `AUTOMATION_DEVICE_OFFLINE_AFTER_SECONDS` (§4) — sinon
   `409 AUTOMATION_DEVICE_OFFLINE` ;
4. aucune commande manuelle déjà `PENDING`/`DELIVERED` non expirée pour ce device —
   sinon `409 COMMAND_ALREADY_PENDING` (anti-double-clic **côté serveur**, jamais fondé
   sur le seul état du bouton frontend) ;
5. `type` fait partie de `DOOR_OPEN`/`DOOR_CLOSE`/`LIGHT_ON`/`LIGHT_OFF` — validé par
   zod avant d'atteindre le service, sinon `422`.

Réponse `201` : la commande créée (`id`, `deviceId`, `zoneKey: null`, `type`, `status:
"PENDING"`, `requestedBy`, `expiresAt`, ...). **Aucune commande manuelle refusée par ces
contrôles n'est mise en file "pour plus tard"** — un device hors ligne au moment du clic
ne verra jamais cette commande, même s'il revient en ligne dans la minute (CDC §5).

```http
GET /api/v1/admin/automation-commands/:id          → statut d'une commande (polling UI)
GET /api/v1/admin/automation-devices/:id/commands?limit=20   → historique (les 20 dernières)
```

Les deux réservés à `STAFF` minimum (lecture, moins sensible que la création).

### Cycle de vie UI (back-office `/admin/automation`)

```text
clic "Ouvrir" (confirmation demandée uniquement pour DOOR_OPEN)
  → bouton désactivé immédiatement (anti-double-clic frontend, en plus du serveur)
  → POST .../commands  → "Envoi..."
  → poll GET /admin/automation-commands/:id toutes les 1 s, jusqu'à 10 s
      PENDING/DELIVERED → "Commande reçue par le Raspberry..."
      SUCCESS           → "Commande exécutée."
      FAILED            → "Échec de la commande (<result>)"
      timeout (10 s)    → "Aucune confirmation reçue du Raspberry."
  → bouton réactivé, historique rafraîchi
```

Testé en direct (navigateur, dev, 2026-09-10) : device en ligne → clic "Allumer" → bouton
désactivé + "Envoi..." → commande livrée via un vrai `GET /snapshot` → sans ACK, timeout
UI à 10 s → "Aucune confirmation reçue du Raspberry.", boutons réactivés, historique
affiché. Device hors ligne (heartbeat > `AUTOMATION_DEVICE_OFFLINE_AFTER_SECONDS`) →
boutons désactivés, message "Commandes indisponibles : Raspberry hors ligne."

`TTL` court et dédié (`MANUAL_COMMAND_TTL_SECONDS`, défaut **30 s**, distinct de
`ACCESS_COMMAND_TTL_MINUTES` utilisé par les commandes zone-scopées) : une commande
manuelle jamais récupérée par le Raspberry dans les 30 s suivant le clic expire et ne
s'exécutera jamais tardivement.

---

## 13. Ce que ce protocole ne couvre pas (hors Phase 1)

- Aucun push serveur → Raspberry : le Raspberry n'accepte jamais de connexion entrante
  (dossier technique §36). Tout passe par son propre poll.
- Aucune commande bas niveau (Wiegand, Modbus, registres LOGO!) : ces 4 types de commande
  sont la seule interface, volontairement pauvre.
- Le mapping `zones[].key` → sortie physique réelle (`Q5`/`Q6`, port série, etc.) est
  **entièrement local au Raspberry** (fichier de config type `config.toml`, dossier
  technique §37) — jamais transmis par ce protocole ni connu du serveur.
