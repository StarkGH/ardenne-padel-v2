# ADR 0027 — Changement d'adresse e-mail avec re-vérification

## Statut
Accepté

## Date
2026-08-16

## Contexte

ADR-0026 avait délibérément exclu le changement d'e-mail de son périmètre : contrairement aux deux autres gaps traités (gestion des participants, recharge kiosque), il ne s'agissait pas d'un écran manquant mais d'une capacité backend absente — aucune route, aucun modèle de jeton dédié à ce flux. Le profil (`/profile`, ADR-0022) affiche l'e-mail en lecture seule depuis le Lot 4.

Le besoin : permettre à un client connecté de changer son adresse e-mail, avec la garantie que la nouvelle adresse est bien contrôlée par lui avant que le compte ne bascule dessus — sans quoi un client pourrait se verrouiller hors de son compte (ou pire, un attaquant en session volée pourrait rediriger silencieusement les e-mails de récupération vers une adresse qu'il contrôle).

## Décision

### 1. Nouveau modèle `EmailChangeToken`, distinct d'`EmailVerificationToken`

Un `EmailVerificationToken` authentifie l'activation d'un compte fraîchement créé (`user.status` passe de `PENDING` à `ACTIVE`) ; il n'a pas de notion d'adresse cible différente de `user.email`. Le changement d'e-mail a besoin de porter une adresse candidate distincte de l'adresse actuelle du compte (déjà `ACTIVE`) — d'où un modèle séparé (`newEmail`, jeton opaque haché, expiration, `usedAt`), suivant exactement le même pattern que `PasswordResetToken`/`EmailVerificationToken` (`generateOpaqueToken()`/`hashToken()`, `apps/api/src/modules/identity/tokens.ts`) plutôt que de surcharger un modèle existant avec un champ optionnel.

### 2. Mot de passe actuel exigé, session non révoquée

`requestEmailChange(userId, newEmail, currentPassword)` exige le mot de passe actuel avant d'émettre le jeton — même garde-fou que `changePassword` (ADR-0022) : une session volée seule ne doit pas suffire à rediriger les e-mails de récupération de compte vers une adresse contrôlée par un attaquant. Contrairement au flux `password/reset` (jeton d'urgence, hors session, qui révoque toutes les sessions à l'usage), il s'agit ici d'un changement volontaire depuis une session déjà authentifiée : la session en cours n'est pas révoquée, ni à la demande, ni à la confirmation — cohérent avec `changePassword`, qui ne révoque pas non plus la session courante.

### 3. Lien de confirmation envoyé uniquement à la nouvelle adresse

`sendEmailChangeConfirmation` cible toujours `newEmail`, jamais l'ancienne adresse. C'est la preuve de possession de la nouvelle adresse qui autorise la bascule — l'ancienne adresse ne reçoit aucune notification tant que le lien n'a pas été cliqué. (Un lot futur pourrait envisager d'avertir aussi l'ancienne adresse une fois le changement confirmé, pour permettre à son titulaire de réagir si le changement n'était pas de son fait — non traité ici, cohérent avec le fait qu'aucune notification équivalente n'existe pour `changePassword` non plus.)

### 4. Endpoint de confirmation public sous `/auth/*`, pas `/me/*`

`POST /api/v1/auth/email-change/confirm` est public (pas de `requireAuth`), alors que toutes les autres routes du profil vivent sous `/me/*` (ADR-0022). Le choix suit le modèle de sécurité, pas la thématique : ce endpoint est sécurisé par la possession du jeton, exactement comme `/auth/verify-email` et `/auth/password/reset`, et doit rester accessible même si le lien est ouvert dans un contexte sans cookie de session (autre navigateur, autre appareil). La demande (`POST /me/profile/email-change`), elle, reste sous `/me/*` car elle nécessite une session authentifiée et le mot de passe actuel.

### 5. Ré-vérification de l'unicité au moment de la confirmation

Entre l'émission du jeton et son utilisation, quelqu'un d'autre a pu enregistrer la même adresse. `confirmEmailChange` revérifie `findUserByEmail(newEmail)` avant d'écrire, pas seulement à la demande initiale.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Réutiliser `EmailVerificationToken` avec un champ `newEmail` optionnel | Mélange deux sémantiques différentes (activation de compte vs. changement d'adresse sur un compte déjà actif) dans un seul modèle ; complique la lecture et les requêtes de recherche/nettoyage |
| Révoquer la session courante à la confirmation, comme `password/reset` | `password/reset` est un flux d'urgence hors session (mot de passe oublié) où la révocation totale est la garantie de sécurité attendue ; ici c'est un changement volontaire déjà protégé par le mot de passe actuel — révoquer aurait déconnecté l'utilisateur sans bénéfice de sécurité supplémentaire, incohérent avec `changePassword` |
| Placer `/email-change/confirm` sous `/me/*` avec `requireAuth` | Casserait le cas d'usage où le lien est ouvert depuis un autre appareil/navigateur sans session active — le jeton est déjà la preuve d'autorisation, une session en plus n'ajoute rien |
| Avertir aussi l'ancienne adresse à la confirmation | Hors périmètre de ce lot ; aucun mécanisme de notification équivalent n'existe pour `changePassword`, pas de raison de le traiter différemment ici sans demande explicite |

## Conséquences

**Positif :** flux vérifié de bout en bout en navigateur réel — demande depuis `/profile` (mot de passe ressaisi), e-mail de confirmation récupéré (dev : log console du serveur), clic sur le lien de confirmation, `GET /auth/me` reflète la nouvelle adresse sans re-connexion (session préservée), connexion avec l'ancienne adresse rejetée (401), connexion avec la nouvelle acceptée (200). 4 nouveaux tests d'intégration (13/13 dans `identity.integration.test.ts`), suite complète 210/210 verts. `npm run build`/`tsc --noEmit` propres côté web et api.

**Négatif / dette assumée :** l'ancienne adresse n'est jamais notifiée qu'un changement a eu lieu (voir alternative écartée ci-dessus). Aucune limite de fréquence dédiée à ce flux au-delà du rate-limiting générique déjà en place sur `/auth/*` et `/me/*`. Un jeton `EmailChangeToken` non utilisé et expiré n'est jamais nettoyé de la table (même dette déjà assumée pour `EmailVerificationToken`/`PasswordResetToken`, hors périmètre).
