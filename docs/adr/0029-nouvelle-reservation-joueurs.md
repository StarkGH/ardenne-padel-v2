# ADR 0029 — Lien vers la création de réservation admin + sélection de joueurs

## Statut
Accepté

## Date
2026-08-17

## Contexte

En vérifiant l'accès à l'écran admin "Nouvelle réservation" (`/admin/bookings/new`, construit au Lot 6, ADR-0024), deux lacunes réelles sont ressorties :

1. **Aucun lien nulle part dans l'interface** ne menait à cet écran — ni le menu de navigation admin, ni le planning, ni le tableau de bord. Il n'était accessible qu'en tapant l'URL à la main.
2. L'écran ne permettait de choisir qu'**un seul client** (l'organisateur) — aucune façon d'ajouter d'autres joueurs à la réservation créée par téléphone/guichet, alors que le parcours client (`/checkout/[bookingId]`, Lot 8, ADR-0026) le permet pour ses propres réservations SPLIT.

## Décision

### 1. Lien de menu + bouton sur le planning

`/admin/bookings/new` ajouté à `NAV_LINKS` (`admin/layout.tsx`) juste après "Planning", et un bouton "+ Nouvelle réservation" ajouté en haut de l'écran Planning lui-même — les deux points d'entrée les plus naturels du flux de travail (l'un pour y aller directement, l'autre en repartant d'une vue déjà ouverte sur le planning).

### 2. Gestion des joueurs juste après création, pas dans le formulaire de création

Comme pour `/checkout/[bookingId]` (ADR-0026), les participants ne peuvent être ajoutés qu'à une réservation déjà créée (`POST /bookings/:id/participants` exige un `bookingId`). L'écran "Réservation créée" (jusqu'ici une simple carte de confirmation) devient un vrai écran de gestion des joueurs, avec le même patron d'UI que côté client (liste + formulaire d'ajout + bouton de retrait), avant de proposer "Voir la réservation".

### 3. Nouvelles routes admin, pas une extension des routes client existantes

`POST/DELETE /bookings/:id/participants` (client) vérifie strictement `booking.organizerUserId === requestedByUserId` — un admin agissant pour le compte d'un client n'est jamais l'organisateur. Plutôt que de complexifier cette vérification avec un bypass conditionnel par rôle, deux nouvelles routes symétriques ont été ajoutées : `POST/DELETE /admin/bookings/:id/participants[/:participantId]`, réservées `requireRole("ADMIN")` (même niveau que la création admin). `BookingsAdminService.adminAddParticipant`/`adminRemoveParticipant` réutilisent directement `BookingsRepository` (comme `adminCancel`/`forceResync` le font déjà) plutôt que `BookingsService.addParticipant` — même garde-fous métier (statut modifiable, capacité du terrain) mais sans le contrôle organisateur, toujours audité en contrepartie (`BOOKING_ADMIN_PARTICIPANT_ADDED`/`_REMOVED`), cohérent avec le reste de ce service (voir commentaire de classe existant).

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Autoriser le rôle ADMIN à passer la vérification organisateur sur les routes client existantes | Mélange deux modèles de sécurité différents sur un seul endpoint (session du client vs action admin auditée) — les routes `/admin/bookings/*` existantes suivent déjà la convention inverse (dupliquer plutôt que percer un trou dans le contrôle client) |
| Sélection de plusieurs joueurs directement dans le formulaire de création, avant `POST /admin/bookings` | Le backend n'accepte qu'un `organizerUserId` à la création (`createBooking`) — il faudrait soit changer ce contrat pour toutes les réservations (client compris), soit créer un chemin spécial admin ; plus simple et cohérent avec l'existant de gérer les joueurs juste après, comme le fait déjà le client |

## Conséquences

**Positif :** vérifié en direct de bout en bout — lien de menu et bouton planning tous deux fonctionnels, réservation créée pour un client existant (Terrain Double, 48,00 €), joueur ajouté avec nom+e-mail (compteur "1/3" mis à jour), retiré (compteur "0/3"), les deux actions tracées dans le journal d'audit (`BOOKING_ADMIN_PARTICIPANT_ADDED`/`_REMOVED`). **Un bug trouvé et corrigé pendant la vérification** : le champ e-mail du formulaire d'ajout était étiqueté "optionnel" côté UI alors que le schéma de validation (`addParticipantSchema`, partagé avec la route client) exige au moins un identifiant (`userId`/`legacyClientId`/`invitedEmail`) — corrigé en rendant l'e-mail obligatoire, cohérent avec le formulaire client équivalent qui a toujours eu cette contrainte. 5 nouveaux tests backend (218 au total, 36 fichiers verts). Build et lint propres.

**Négatif / dette assumée :** pas de recherche de joueur existant (V2 ou Legacy) depuis cet écran — seul un nom + e-mail d'invitation est proposé, contrairement au client qui peut aussi lier un `userId` (dette déjà présente côté client, non aggravée ici). Pas de message explicite quand la capacité du terrain limite l'ajout (le formulaire disparaît silencieusement), même limitation déjà documentée pour l'écran client en ADR-0026.
