# Protocole Raspberry — Automatisation physique (Phase 1)

Contrat exact entre AP V2 (serveur) et le contrôleur Raspberry (`ardenne-access-01`),
tel qu'implémenté dans `apps/api/src/modules/automation/`. Ce document décrit le code
réellement en place, pas le CDC théorique — en cas de divergence future entre les deux,
ce fichier fait foi côté implémentation et doit être mis à jour dans le même commit que
tout changement de comportement.

**Statut** : Phase 1 — données uniquement, aucune action physique déclenchée par le
serveur. Testé en dev local (WSL) le 2026-09-10, transport HTTP validé de bout en bout
(auth, snapshot, ETag/304, heartbeat, commandes avec ACK, événements). Le Raspberry réel
(`ardenne-access-01`) n'est pas encore branché dessus.

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
      { "id": "e04f5abb-3999-4e6d-a44f-f5adaeb7e33e", "zoneKey": "main_entry", "type": "OPEN_DOOR_PULSE" }
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
| `grants[].origin` | `V2_GENERATED \| LEGACY_IMPORTED` | Purement informatif pour le Raspberry (debug/audit) — la validation locale du code ne doit pas différer selon l'origine. |
| `grants[].validFrom` / `validUntil` | ISO 8601 UTC | Fenêtre de validité (inclut déjà les marges `ACCESS_ENABLED_BEFORE/AFTER_MINUTES`). |
| `lightIntervals[].zoneKey` | string | Référence `zones[].key` d'une zone `LIGHT`. |
| `lightIntervals[].startsAt` / `endsAt` | ISO 8601 UTC | Intervalle déjà marginé (`LIGHT_ENABLED_BEFORE/AFTER_MINUTES`) et **fusionné** : deux réservations qui se chevauchent ou se suivent immédiatement après marge ne produisent jamais deux intervalles distincts (voir §8). |
| `commands[].id` | string uuid | À utiliser tel quel dans `POST /commands/:id/ack`. |
| `commands[].zoneKey` | string | Référence `zones[].key`. |
| `commands[].type` | `OPEN_DOOR_PULSE \| LIGHT_OVERRIDE_ON \| LIGHT_OVERRIDE_OFF \| CLEAR_LIGHT_OVERRIDE` | Liste MVP fermée — jamais de commande bas niveau (dossier technique §36/§37). |

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
`ACCESS_DEVICE_OFFLINE_THRESHOLD_MINUTES`, défaut 5 min).

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
SUCCESS   (retirée du snapshot, définitivement — un revision différent
           est immédiatement visible, voir §6)

Fallback si aucun ACK n'arrive jamais :
DELIVERED → EXPIRED à `expiresAt` (défaut `ACCESS_COMMAND_TTL_MINUTES` = 10 min
après la création) — nettoyage best-effort exécuté au début de chaque `buildSnapshot`.
```

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
POST /api/v1/devices/automation/commands/e04f5abb-3999-4e6d-a44f-f5adaeb7e33e/ack HTTP/1.1
Authorization: Bearer <deviceKey>
```

Pas de corps.

### Réponses

| Code | Cas |
|---|---|
| `204 No Content` | ACK accepté — la commande passe `DELIVERED → SUCCESS`. |
| `404 Not Found` | Commande inconnue, **déjà ACKée** (pas de double-crédit), jamais délivrée (encore `PENDING`, donc pas encore `DELIVERED` — l'ACK ne saute jamais l'étape de livraison), ou expirée. Le Raspberry ne doit **pas** retenter automatiquement sur un `404` de ce type (ce n'est pas une erreur transitoire) — journaliser et passer à autre chose. |

Vérifié en direct (dev, 2026-09-10) : `GET` (commande présente) → `GET` sans ACK
(commande **toujours** présente, id identique) → `ACK` (`204`) → `GET` (commande absente)
→ ré-`ACK` sur le même id (`404`).

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
`LIGHT_ENABLED_AFTER_MINUTES` (défaut 10), puis fusionne tout intervalle qui chevauche ou
touche exactement le suivant (`apps/api/src/modules/automation/light-interval-merger.ts`).

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
| `404` (sur `/ack`) | Commande déjà ACKée/jamais délivrée/expirée | Ne pas retenter — journaliser et continuer. |
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

## 11. Ce que ce protocole ne couvre pas (hors Phase 1)

- Aucun push serveur → Raspberry : le Raspberry n'accepte jamais de connexion entrante
  (dossier technique §36). Tout passe par son propre poll.
- Aucune commande bas niveau (Wiegand, Modbus, registres LOGO!) : ces 4 types de commande
  sont la seule interface, volontairement pauvre.
- Le mapping `zones[].key` → sortie physique réelle (`Q5`/`Q6`, port série, etc.) est
  **entièrement local au Raspberry** (fichier de config type `config.toml`, dossier
  technique §37) — jamais transmis par ce protocole ni connu du serveur.
