# ADR 0034 — Écran admin de revue des conflits de migration (MERGE_REQUIRED)

## Statut
Accepté

## Date
2026-08-17

## Contexte

Le script d'import (ADR-0032) applique la déduplication automatique CDC §7.5 et flague `MERGE_REQUIRED` tout `LegacyClient` dont le rapprochement ne peut pas être décidé sans ambiguïté (e-mail correspondant à plusieurs comptes V2, ou seulement un signal GSM). Le CDC §7.5 est explicite : *"validation manuelle administrateur en cas de conflit"* — jusqu'ici sans aucun écran pour l'exercer, ces fiches restaient invisibles une fois flaguées.

## Décision

### Nouveau module admin dédié, pas une extension de la fiche client CRM

`LegacyMigrationAdminService`/`legacy-migration-admin.routes.ts` plutôt que d'ajouter cette revue à `CrmService` (fiche client, CDC §40) : l'objet manipulé ici est un `LegacyClient` *avant* toute existence d'un compte V2 associé (le cas nominal), pas une fiche client V2 existante — sémantiquement différent, même si les deux modules finissent par se croiser une fois le lien posé.

### Trois actions, pas plus : lier, rejeter, remettre en attente

- **Lier** (`POST /admin/legacy-clients/:id/link`) — choix manuel d'un compte V2 via la recherche client déjà existante (`GET /admin/clients?q=`, réutilisée telle quelle, aucun nouvel endpoint de recherche). Passe en `MIGRATED`, efface `mergeNote`. Revalide l'unicité de `linkedUserId` côté service (même garde-fou que le script d'import) plutôt que de laisser la seule contrainte DB renvoyer une erreur Prisma brute à l'admin.
- **Rejeter** (`.../disable`) — passe en `DISABLED`, motif optionnel conservé dans `mergeNote` pour traçabilité ("pourquoi a-t-on décidé que ce n'était pas la même personne").
- **Remettre en attente** (`.../reset`) — repasse en `LEGACY_ONLY`, efface `mergeNote` et tout lien existant. Permet au prochain import de retenter la déduplication automatique (utile si le conflit se résout tout seul, ex. un compte V2 en double supprimé entretemps).

Pas de quatrième action "envoyer une invitation" : `ClientMigrationInvitation` (ADR-0031) existe côté modèle mais aucune route ne le consomme encore — hors périmètre de cet écran, qui ne fait que trancher un rapprochement, pas déclencher un parcours joueur.

### Lier/rejeter interdits depuis un état déjà résolu, sauf après reset explicite

`linkToUser` refuse tout statut hors `MERGE_REQUIRED`/`LEGACY_ONLY` (409). Empêche qu'un clic accidentel écrase silencieusement un `MIGRATED` déjà posé ou un `INVITED`/`MIGRATION_PENDING` en cours — l'admin doit explicitement `reset` d'abord s'il veut vraiment revenir en arrière, un geste délibéré plutôt qu'un side-effect d'un second clic sur "lier".

### Filtre par statut, pas seulement une liste `MERGE_REQUIRED` figée

L'écran accepte n'importe quel `ClientMigrationStatus` en query param (`GET /admin/legacy-clients?status=`), avec `MERGE_REQUIRED` comme onglet par défaut. Coût nul (même requête, un seul paramètre) pour un vrai bénéfice : l'admin peut aussi consulter qui a déjà été `MIGRATED`/`DISABLED` sans repasser par une requête SQL manuelle.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Ajouter la revue MERGE_REQUIRED à la fiche client CRM existante | L'objet à traiter n'a souvent aucun compte V2 associé au moment de la revue — la fiche client V2 ne peut pas exister pour ce cas |
| Construire aussi le flux d'invitation dans ce lot | Demande explicite portait sur la revue des conflits ; l'invitation est un flux distinct (envoi d'e-mail, page de clic, création de compte) qui mérite son propre ADR |
| Autoriser `linkToUser` depuis n'importe quel statut, y compris `MIGRATED` | Aurait permis d'écraser silencieusement un lien déjà posé par un second clic malheureux — le `reset` explicite force une étape consciente |

## Conséquences

**Positif :** vérifié en direct de bout en bout — client `MERGE_REQUIRED` inséré manuellement, recherche du bon compte V2, liaison confirmée (disparaît de l'onglet "Conflit à valider", réapparaît sous "Migré" avec le compte lié affiché), action tracée dans le journal d'audit (`LEGACY_CLIENT_LINKED`). 7 nouveaux tests backend (244 au total, 40 fichiers verts). Build et lint propres.

**Négatif / dette assumée :** pas de vue groupée montrant plusieurs candidats simultanément avec un score de correspondance — l'admin doit rechercher manuellement le bon compte à chaque fois, même quand le `mergeNote` mentionne déjà les comptes candidats trouvés par la déduplication automatique. Pas de lien direct depuis un `mergeNote` vers les comptes V2 qu'il cite.
