# ADR 0031 — Modèle de données pour l'import Doinsport (clients + réservations)

## Statut
Accepté

## Date
2026-08-17

## Contexte

`LegacyDoinsportAdapter` sait interroger l'API Doinsport (`listClients`, `listBookings`, `getBooking`) depuis le Lot 2, mais rien n'appelle ces méthodes pour peupler la base V2 : aucun code ne persiste de fiche client ni de réservation importée, aucun scheduler n'existe (`LEGACY_SYNC_INTERVAL_SECONDS` est en config depuis le Lot 0 et n'a jamais été lu). Deux besoins concrets, tous deux déjà normatifs au CDC mais jamais construits :

1. **Migration d'identité** (CDC §7.3-§7.5) : synchroniser les fiches clients Doinsport, les rattacher progressivement à des comptes V2 via un lien d'invitation, avec une machine à états explicite et une procédure de déduplication en cas de conflit.
2. **Anti-collision pendant le Dual Run** (CDC §10.3) : *"les réservations Doinsport sont intégrées comme occupations externes"* — non implémenté aujourd'hui. `AvailabilityRepository.findOccupyingBookings` ne lit que la table `Booking` V2 ; un créneau déjà pris sur Doinsport peut donc s'afficher disponible côté V2 (mitigé par le fait que la création Doinsport reste l'arbitre final au moment de la confirmation, mais l'expérience utilisateur en pâtit).

Ce ADR couvre uniquement le **modèle de données** — le job de synchro lui-même (script d'import initial, scheduler récurrent) est un lot distinct, non traité ici.

## Décision

### 1. Étendre `LegacyClient` plutôt que créer un `ShadowClient` séparé

`docs/migration.md` et le CDC §7.3 parlent de "Shadow Client" comme d'un concept distinct. Mais `LegacyClient` (Lot 2) porte déjà exactement ce rôle — le commentaire du schéma le dit explicitement depuis le Lot 2 : *"`legacy_clients` reprend CDC §45 et fait aussi office de la table `legacy_user_mapping`... une seule table plutôt que deux redondantes"*. Créer un second modèle aurait dupliqué `externalId`/`firstName`/`lastName`/`email`/`linkedUserId` pour un gain nul. Ajouté à `LegacyClient` :
- `migrationStatus` (enum CDC §7.4 : `LEGACY_ONLY`/`INVITED`/`MIGRATION_PENDING`/`MIGRATED`/`DISABLED`/`MERGE_REQUIRED`), explicite plutôt que déduit de `linkedUserId` — `INVITED` et `MIGRATION_PENDING` ont tous deux `linkedUserId` nul mais ne sont pas le même état, un booléen ou un simple nullable ne suffit pas.
- `mergeNote` (texte libre, rempli uniquement en `MERGE_REQUIRED`) pour que l'admin qui tranche un conflit de déduplication (CDC §7.5) sache pourquoi le rapprochement automatique a échoué.
- `linkedUserId` promu en vraie relation Prisma (`@unique`, `@relation`) — jusqu'ici une simple chaîne indexée sans contrainte. La contrainte d'unicité empêche qu'un compte V2 se retrouve lié à deux clients Doinsport différents, un vrai bug possible avant ce changement.

### 2. `LegacyBooking` : une ligne par terrain occupé, pas un miroir 1:1 de la réservation Doinsport

`LegacyBookingDto.playgroundIds` est un tableau — une réservation Doinsport peut couvrir plusieurs terrains. Le besoin d'anti-collision (CDC §10.3) est intrinsèquement "par terrain, par plage horaire" — exactement la forme de requête déjà utilisée pour `Booking` V2. Aplatir à l'import (une ligne `LegacyBooking` par `(externalId, courtId)`) permet une requête directe symétrique à `findOccupyingBookings`, sans jointure sur un tableau à chaque calcul de disponibilité. `@@unique([externalId, courtId])` sert aussi de cible d'upsert pour la resynchronisation périodique (idempotence).

### 3. `legacyClientId` sur `LegacyBooking` : nullable, dépendance explicite plutôt qu'omission silencieuse

`LegacyBookingDto` (tel que mappé aujourd'hui par l'adapter) n'expose pas le propriétaire de la réservation — seul `raw: unknown` porte potentiellement cette info côté Doinsport. Rendre le champ obligatoire aurait été une hypothèse non vérifiée sur le contenu réel de l'API (CDC §111, anti-pattern proscrit). Nullable, avec un commentaire de schéma documentant explicitement que la résolution de ce champ dépendra d'une extension du mapping DTO dans le lot d'import — pas laissé à découvrir plus tard.

### 4. `LegacySyncRun` : table dédiée, pas le journal d'audit générique

`AuditLogService` existe déjà et journalise toute action admin. Un job récurrent n'est pas un acteur humain : sa fréquence et son volume (potentiellement une exécution toutes les `LEGACY_SYNC_INTERVAL_SECONDS`) pollueraient un journal pensé pour la revue humaine (CDC §58). Table minimale et distincte (`kind`, `status`, compteurs `itemsSeen`/`itemsChanged`, `errorSummary`) — juste assez pour qu'un futur écran admin affiche "dernière synchro : il y a 4 minutes, 12 clients mis à jour" sans avoir à le deviner depuis les logs applicatifs.

### 5. `ClientMigrationInvitation` : jeton rattaché au `LegacyClient`, pas au `User`

Même pattern opaque haché que `EmailVerificationToken`/`PasswordResetToken`/`EmailChangeToken` (`generateOpaqueToken()`/`hashToken()`), mais le `User` n'existe pas encore à l'émission — c'est justement ce que la redemption du jeton crée (CDC §7.3, points 6-7 : le joueur choisit son mot de passe *après* avoir cliqué le lien). D'où un modèle séparé plutôt qu'une réutilisation forcée d'`EmailVerificationToken`, qui suppose toujours un `userId` existant.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Modèle `ShadowClient` séparé, fidèle au vocabulaire CDC/migration.md | Duplique `LegacyClient` champ pour champ ; le schéma documente déjà depuis le Lot 2 que `legacy_clients` joue ce rôle |
| `LegacyBooking` stockant `playgroundIds` en tableau (JSON/array Postgres), une ligne par réservation Doinsport | Complique chaque requête d'anti-collision (recherche "contient ce courtId" au lieu d'une égalité indexée) pour un gain de normalisation marginal |
| Rendre `legacyClientId` obligatoire sur `LegacyBooking` | Suppose que l'API Doinsport expose toujours un propriétaire exploitable sans l'avoir vérifié — hypothèse non fondée à ce stade |
| Journaliser les exécutions de synchro dans `AuditLog` | Conçu pour des actions humaines revues manuellement ; un job récurrent y introduirait un volume et une fréquence hors de ce périmètre |
| `ClientMigrationInvitation` réutilisant `EmailVerificationToken` avec un `userId` nullable | Mélange deux sémantiques (vérification d'un compte existant vs. création d'un compte à partir d'un jeton) dans un seul modèle, comme déjà écarté pour `EmailChangeToken` (ADR-0027) |

## Conséquences

**Positif :** schéma appliqué (migration `20260817131716_legacy_import_model`), 8 nouveaux tests validant les invariants clés (défaut `LEGACY_ONLY`, parcours complet jusqu'à `MIGRATED` avec liaison réelle, unicité d'un `linkedUserId` par utilisateur, cascade de suppression des invitations, requête d'occupation par terrain/plage horaire, exclusion des réservations annulées, upsert idempotent, cycle de vie d'un `LegacySyncRun`). 226 tests au total, 37 fichiers verts. Aucune régression (changement additif uniquement).

**Négatif / dette assumée :** aucun code n'utilise encore ce modèle — ni script d'import initial, ni job récurrent, ni extension du mapping DTO pour résoudre `legacyClientId` sur les réservations importées, ni écrans admin (revue `MERGE_REQUIRED`, tableau de bord `LegacySyncRun`), ni intégration dans `AvailabilityRepository.findOccupyingBookings` pour que l'anti-collision CDC §10.3 devienne réellement effective. Ce sont les prochaines étapes, hors périmètre de cet ADR qui ne couvre que le modèle de données.
