# ADR 0036 — Flux de rédemption de l'invitation de migration Doinsport

## Statut
Accepté

## Date
2026-08-17

## Contexte

`ClientMigrationInvitation` (ADR-0031) posait déjà le modèle de données (jeton opaque haché, rattaché au `LegacyClient` puisqu'aucun `User` n'existe encore à l'émission) mais aucune route ne le consommait. Le CDC §7.3 décrit la stratégie complète, faute d'endpoint d'authentification joueur Doinsport confirmé :

1. synchroniser les fiches clients Doinsport ;
2. créer des `ShadowClient` (`LegacyClient`, déjà fait depuis le Lot 2) ;
3. envoyer une invitation de migration à l'adresse e-mail connue ;
4. le joueur clique sur un lien unique à durée limitée ;
5. l'e-mail est considéré comme vérifié par possession du lien ;
6. le joueur choisit son mot de passe V2 ;
7. le Shadow Client est lié au nouvel utilisateur local ;
8. conserver `legacy_client_id`.

Ce lot construit les étapes 3 à 8, dernière pièce manquante du Lot 11 (import + synchro Doinsport).

## Décision

### Déclenchement admin, jamais automatique à l'import

`MigrationInvitationService.invite()` est appelé depuis un nouveau bouton "Inviter à migrer" sur `/admin/legacy-clients` (écran existant, ADR-0034), pas depuis le script d'import ou le scheduler récurrent (ADR-0035). `docs/migration.md` gouverne la migration par cohortes progressives (Phase 2 pilote → Phase 4 généralisation) — envoyer une invitation dès qu'un client Legacy est synchronisé court-circuiterait cette stratégie et enverrait des centaines d'e-mails non désirés dès le premier import. Autorisé depuis `LEGACY_ONLY` (cas nominal) ou `INVITED` (renvoi du lien, ex. expiré) — jamais depuis un état déjà résolu ou en conflit (`MERGE_REQUIRED` doit d'abord être tranché manuellement).

### Logique d'import extraite, pas dupliquée

`MigrationInvitationService` (nouveau, `modules/legacy-doinsport/`) réutilise directement `IdentityRepository.createUser` (module `identity/`, déjà utilisé par `register`), `generateOpaqueToken`/`hashToken` (`identity/tokens.ts`, déjà partagé avec `EmailVerificationToken`/`PasswordResetToken`/`EmailChangeToken`) et une nouvelle fonction `assertPasswordStrength` extraite d'`IdentityService` vers `identity/password.ts` — même règle de robustesse (10 caractères) partagée par inscription, reset de mot de passe et migration, plutôt que trois copies de la même constante.

### Compte créé `ACTIVE` directement, jamais `PENDING_VERIFICATION`

`IdentityRepository.createUser` gagne un paramètre `status` optionnel (défaut inchangé : `PENDING_VERIFICATION`). Le flux de migration passe explicitement `ACTIVE` — le CDC est explicite (étape 5) : la possession du lien reçu par e-mail *est* la vérification d'e-mail. Imposer un second e-mail de vérification après celui-ci aurait ajouté une friction non justifiée par le CDC et un risque réel de perte du joueur en cours de route (deux clics au lieu d'un pour activer un compte).

### `validateToken` (lecture) séparée de `confirm` (écriture)

Le lien reçu par e-mail pointe vers `/migrate?token=...` (nouvelle page publique), qui appelle d'abord `POST /auth/migration-invite/validate` pour récupérer prénom/nom/e-mail à préremplir sur le formulaire de mot de passe, *avant* de consommer le jeton. Cette étape transitionne `INVITED → MIGRATION_PENDING` (best-effort, idempotente) mais ne marque jamais le jeton `usedAt` — un rechargement de page ou un aller-retour du joueur ne grille pas son lien. Seul `confirm()` (`POST /auth/migration-invite/confirm`) consomme réellement le jeton, après avoir revalidé l'unicité de l'e-mail (quelqu'un a pu s'inscrire directement avec cette adresse entretemps — même garde que `confirmEmailChange`, ADR-0027).

### Pas d'audit log admin sur `confirm()`

`invite()` (déclenché par un admin) est audité comme les autres actions de `LegacyMigrationAdminService` (`LEGACY_CLIENT_INVITED`). `confirm()` est une action self-service du joueur, pas une action administrative (CDC §58 : "toutes les actions **administratives** sensibles sont journalisées") — seul un `logger.info` structuré la trace, cohérent avec `verifyEmail`/`confirmEmailChange` qui ne passent pas non plus par le journal d'audit.

### Pas d'auto-connexion après confirmation

Contrairement à `login()`, `confirm()` ne crée pas de session — le joueur est redirigé vers `/login` après création de son compte. Choix délibéré de cohérence : aucun autre flux basé sur un jeton du projet (`verifyEmail`, `resetPassword`, `confirmEmailChange`) ne connecte automatiquement l'utilisateur ; en introduire un ici aurait été une incohérence UX sans justification du CDC.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Envoi automatique de l'invitation dès l'import (étape 3 du CDC lue littéralement, sans intervention admin) | Contredit `docs/migration.md` (migration par cohortes) — enverrait des invitations en masse dès le premier import de 1090 clients |
| Auto-connexion après `confirm()` | Aucun autre flux par jeton du projet ne le fait ; incohérence UX sans bénéfice clair, le CDC ne l'exige pas |
| Réutiliser `PENDING_VERIFICATION` + un e-mail de vérification classique après la migration | Contredit explicitement le CDC §7.3 étape 5 ("l'e-mail est considéré comme vérifié par possession du lien") — friction supplémentaire non justifiée |
| Invalider les invitations précédentes lors d'un renvoi | Même convention que `password/forgot` (plusieurs jetons valides simultanément acceptés) — complexité inutile pour un risque de sécurité négligeable |

## Conséquences

**Positif :** vérifié en direct de bout en bout — client `LEGACY_ONLY` inséré avec une adresse e-mail réelle, invitation envoyée depuis l'écran admin (bouton "Inviter à migrer"), lien récupéré depuis les logs serveur (`dev-email`), page `/migrate` ouverte dans un contexte déconnecté, identité correctement préremplie, mot de passe choisi, compte créé et connexion immédiate réussie **sans étape de vérification supplémentaire**, fiche repassée en "Migré" côté admin avec le lien affiché. 9 nouveaux tests backend (259 au total, 42 fichiers verts). Build et lint propres côté web et api. **Le Lot 11 (import + synchro Doinsport) est désormais intégralement complet.**

**Négatif / dette assumée :** pas de nettoyage des invitations expirées non utilisées (même dette déjà assumée pour les autres types de jetons du module identity) ; pas de limite sur le nombre de renvois d'une invitation (un admin peut cliquer "Renvoyer" autant de fois qu'il veut, chaque jeton restant valide indépendamment jusqu'à sa propre expiration) ; l'écran admin n'affiche pas la date d'expiration du jeton en cours, seulement le statut `INVITED`.
