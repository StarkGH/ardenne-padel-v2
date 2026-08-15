# ADR 0022 — Parcours frontend Profil / moyens de paiement

## Statut
Accepté

## Date
2026-08-15

## Contexte

Après ADR-0019/0020/0021 (FULL, SPLIT, wallet), ce lot construit les écrans 18 "Profil" et 19 "Gestion moyens de paiement" du CDC §54. Contrairement aux trois lots précédents, aucun des deux endpoints requis n'existait côté backend : `GET /auth/me` ne renvoie que `{id, email, role, status, pilotUser}` (le strict nécessaire aux contrôles d'accès, attaché sur chaque requête authentifiée par `attachAuthUser`), il n'y a pas de route de mise à jour du profil, pas de changement de mot de passe authentifié (seul le flux par jeton e-mail existe), et pas de modèle local de moyens de paiement enregistrés — Ardenne Padel ne stocke jamais de donnée carte (CDC §2.6), uniquement des références Stripe.

## Décision

### 1. `GET/PATCH /me/profile` plutôt qu'élargir `req.authUser`

`req.authUser` (attaché par `attachAuthUser` sur *chaque* requête authentifiée, quel que soit l'endpoint) reste volontairement minimal — y ajouter `firstName/lastName/phone/createdAt` aurait alourdi une requête Prisma exécutée en permanence pour un besoin propre à un seul écran. À la place, deux routes dédiées (`apps/api/src/modules/identity/profile.routes.ts`) rechargent l'utilisateur à la demande. Montées sous `/api/v1/me/*` (comme `/me/wallet`, `/me/bookings`, `/me/payment-methods`) et non sous `/api/v1/auth/*` : ce ne sont pas des actions d'authentification, seulement une lecture/mise à jour du compte courant.

### 2. Changement de mot de passe authentifié : nouvel endpoint, sessions non révoquées

`POST /auth/password/change` (mot de passe actuel + nouveau) est distinct de `POST /auth/password/reset` (jeton e-mail, CDC §111 — cas "compte compromis"). Contrairement au reset, le changement volontaire **ne révoque pas** les sessions actives : l'utilisateur vient de prouver qu'il connaît le mot de passe actuel depuis une session déjà authentifiée, le déconnecter immédiatement après n'aurait apporté aucune garantie de sécurité supplémentaire et aurait dégradé l'expérience (reconnexion forcée juste après avoir volontairement changé son mot de passe). Vérifié en direct : la session courante reste valide après le changement, tandis que l'ancien mot de passe est immédiatement refusé au login.

### 3. Moyens de paiement : aucun modèle local, tout passe par `PaymentProvider`

`GET /me/payment-methods` / `DELETE /me/payment-methods/:id` sont ajoutés à l'interface `PaymentProvider` (`listPaymentMethods`, `detachPaymentMethod`) plutôt qu'implémentés en accès direct au SDK Stripe dans les routes — même abstraction que `createPayment`/`refund`/etc. (CDC §21.1). Deux décisions notables dans `StripePaymentProvider` :
- **Pas de client Stripe créé à la volée pour la lecture.** `GET /me/payment-methods` vérifie d'abord si l'utilisateur a un `stripeCustomerId` ; si non, renvoie `[]` sans appeler le provider — contrairement à `ensureStripeCustomer` (utilisé par `/payments/setup` et le checkout), qui *crée* un client Stripe au besoin. Un utilisateur qui n'a jamais rien payé n'a pas à dépendre de la configuration Stripe pour voir une liste vide.
- **Vérification d'appartenance avant `detach()`.** L'API Stripe `paymentMethods.detach(id)` n'est pas scopée par customer — n'importe quel `paymentMethodId` valide serait détachable par n'importe quel appelant authentifié sans ce contrôle (CDC §111). `detachPaymentMethod` liste d'abord les méthodes du customer appelant et vérifie que l'id ciblé y figure avant d'appeler `detach()`, sinon 404. Testé (`stripe-payment-provider.test.ts`, `payment-methods.routes.test.ts` — y compris un scénario "utilisateur B tente de supprimer une carte de l'utilisateur A").

### 4. Ajout de carte : réutilise `POST /payments/setup` existant, pas de nouvel endpoint

Le SetupIntent Stripe (`POST /payments/setup`, déjà utilisé pour la garantie `CARD_OFF_SESSION` du split, ADR-0012) est le mécanisme correct pour attacher une nouvelle carte à un customer — inutile de dupliquer un second endpoint. Le bouton "Ajouter une carte" de l'écran 19 l'appelle directement et affiche la même dégradation `STRIPE_NOT_CONFIGURED` que le reste du parcours de paiement (ADR-0010) ; la confirmation réelle via Stripe.js/Elements reste à câbler avec un vrai compte Stripe, comme chaque écran de paiement du projet depuis le Lot 4.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Étendre `req.authUser`/`attachAuthUser` avec les champs de profil | Alourdit une requête Prisma exécutée sur chaque appel authentifié pour un besoin propre à un seul écran ; `GET /me/profile` recharge à la demande sans coût ailleurs |
| Révoquer toutes les sessions après un changement de mot de passe volontaire, comme le reset par jeton | Le reset par jeton traite un cas potentiel de compte compromis (CDC §111) ; un changement volontaire depuis une session déjà authentifiée n'a pas la même justification, et déconnecter l'utilisateur juste après aurait été une régression d'expérience sans gain de sécurité clair |
| Stocker un modèle `PaymentMethod` local (id, brand, last4, isDefault) | Duplique un état déjà géré par Stripe (source de vérité), risque de désynchronisation (carte expirée/supprimée côté Stripe sans que la copie locale le sache), et viole l'esprit de CDC §2.6 (ne jamais devenir un second système de vérité sur les moyens de paiement) |
| Appeler `paymentMethods.detach()` sans vérification d'appartenance, en faisant confiance à l'id fourni par le client | Stripe ne scope pas `detach()` par customer — un utilisateur authentifié pourrait détacher la carte de n'importe quel autre client avec seulement son `paymentMethodId` (CDC §111) |

## Conséquences

**Positif :** écran 18 vérifié en direct dans un navigateur réel de bout en bout — lecture du profil, modification prénom/nom/téléphone persistée (relue après rechargement complet de la page), refus propre d'un mot de passe actuel incorrect, changement de mot de passe réussi avec session courante préservée et ancien mot de passe immédiatement refusé au login, déconnexion de toutes les sessions fonctionnelle. Écran 19 vérifié pour son état vide (aucun appel Stripe sans `stripeCustomerId`) et sa dégradation `STRIPE_NOT_CONFIGURED` sur "Ajouter une carte". 11 nouveaux tests backend (3 `StripePaymentProvider` — liste/détache/refus d'appartenance croisée, 4 route-level `payment-methods`, 4 intégration profil/mot de passe), 191 au total. Build et lint frontend/backend propres.

**Négatif / dette assumée :** liste/suppression de cartes non vérifiables en direct avec de vraies données (nécessite un compte Stripe pour qu'une carte existe réellement) — couvert uniquement par les tests backend avec `FakePaymentProvider`. Pas de marquage "carte par défaut" (Stripe n'a pas de notion de méthode par défaut au niveau `PaymentMethod`, seulement `Customer.invoice_settings.default_payment_method` — non exposé pour l'instant). Changement d'e-mail non traité dans ce lot (nécessiterait son propre flux de re-vérification, distinct de l'inscription). Kiosque et les 25 écrans admin restent à construire.
