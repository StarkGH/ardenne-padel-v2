# ADR 0018 — Durcissement pré-pilote (Lot 10)

## Statut
Accepté

## Date
2026-08-15

## Contexte

Le CDC §100/§101/Annexe B décrit un lot de clôture avant un pilote avec de vrais utilisateurs et du vrai argent : suite E2E Playwright, tests de concurrence (§67), tests de résilience (§68), backup/restore testé réellement, monitoring/alertes (§57.4), revue de sécurité (§59), revue juridique/comptable (V-018 à V-024), et le passage de la checklist Annexe B. Comme pour tous les lots précédents, une partie de ce périmètre est du frontend (dashboard, écrans) ou de l'infrastructure externe (monitoring, secrets de production) qui n'existent pas dans cette session — la décision de scope suit exactement le même principe que les ADR précédentes (0014, 0016, 0017) : livrer ce qui est du ressort du backend, documenter honnêtement ce qui ne l'est pas.

## Décision

### 1. Un vrai bug de concurrence trouvé et corrigé, pas seulement testé

En écrivant les tests de concurrence exigés par le CDC §67, `CheckoutService.checkout()`, `SplitCheckoutService.checkout()` et `BookingsService.cancelBooking()` se sont révélés **non protégés contre le double-clic/l'annulation concurrente** : rien n'empêchait deux requêtes simultanées de créer chacune leur hold wallet, leur autorisation Stripe, ou de déclencher chacune leur annulation Legacy. `BookingsRepository.transitionStatus(id, fromStatus, toStatus)` (transition conditionnelle `WHERE status = fromStatus`, sur le modèle déjà établi pour les holds wallet — `WalletRepository.transitionHold` — et les achats de packs — `markCreditedIfPaid`) ferme cette fenêtre : la réclamation devient atomique et précède toute action externe. `BookingShareService.payShare` avait la même faille pour le double paiement d'une part — corrigée en activant enfin `BookingShareStatus.PAYMENT_PENDING`, un statut présent dans le schéma depuis le Lot 6 mais jamais utilisé comme état de réclamation.

### 2. La réclamation atomique a elle-même besoin d'un filet de sécurité

Réclamer la réservation (`CHECKOUT_PENDING` → `PAYMENT_PENDING`) avant tout appel externe crée un nouveau risque : si cet appel externe lève une exception non anticipée (timeout Stripe, panne réseau) plutôt que de renvoyer un statut d'échec propre, la réservation reste bloquée en `PAYMENT_PENDING` indéfiniment — exactement le genre de "perte silencieuse" que le CDC §68 proscrit. Chaque `checkout()` est donc enveloppé d'un filet de sécurité : en cas d'exception, une transition conditionnelle (`PAYMENT_PENDING` → `CHECKOUT_PENDING`) tente de rendre la réservation à nouveau réclamable — sans effet si une branche explicite a déjà fixé un état terminal (`FAILED`/`MANUAL_REVIEW`/`CONFIRMED`) avant de lever son erreur, puisque la transition n'est plus possible à partir de `PAYMENT_PENDING`. Trouvé en écrivant les tests de résilience (§68) : une capture Stripe qui lève une exception (plutôt que de renvoyer un statut) après que Legacy a déjà confirmé n'était pas distinguée d'une capture qui échoue proprement — corrigé pour produire `MANUAL_REVIEW` dans les deux cas, jamais un retour silencieux à `CHECKOUT_PENDING` alors que Legacy a une réservation réelle.

### 3. Sécurité : combler les vrais manques, documenter le reste

`helmet`, `cors` (liste blanche explicite via `CORS_ALLOWED_ORIGINS`) et `express-rate-limit` (global + limite dédiée sur `/auth/*`) étaient absents du projet — comblés dans ce lot, ce sont des ajouts bornés et à faible risque. Le reste de la checklist §59 (voir `docs/security.md`) était déjà largement couvert depuis les lots précédents (cookies, RBAC, validation stricte, pas de stacktrace côté client) ou reste hors du contrôle du code (clés Stripe test/prod distinctes — pas de compte Stripe ; privilèges du compte Doinsport — décision opérationnelle du club).

### 4. Feature flag pilote : cohorte restreinte, pas un simple booléen global

L'Annexe B demande un "feature flag pilote activable pour une cohorte réduite" — pas seulement un interrupteur on/off. `User.pilotUser` (nouveau champ) + `PILOT_MODE_ENABLED` permettent de n'autoriser la création de réservations qu'aux comptes explicitement marqués pilote, via `PATCH /admin/clients/:userId/pilot-cohort` (audité). Le garde-fou vit dans `BookingsService.createBooking` (pas seulement à la route HTTP) pour s'appliquer identiquement au parcours web (`bookings.routes.ts`) et au parcours QR handoff kiosque (`kiosk-checkout-session.service.ts`), qui appellent tous deux la même méthode.

### 5. Backup/restore : mécanisme validé réellement, pas seulement documenté

CDC §61 : "avant cutover, effectuer un test réel de restauration". Un test `pg_dump`/`pg_restore` complet a été exécuté contre la base de développement (voir `docs/backup-restore.md`) — dump, restauration dans une base séparée, comparaison des comptages de lignes, nettoyage. Les temps mesurés (1s/1s) ne sont représentatifs que du volume de développement ; documentés comme tels plutôt que présentés comme des RTO de production.

### 6. Les scénarios "E2E Playwright" restent des tests HTTP/service, pas navigateur

Comme pour tout le reste du projet, aucun frontend n'existe. Les 25 scénarios du CDC §66 sont mappés un par un vers la couverture de test existante (`docs/testing.md`) — 16 couverts, 6 partiels, 3 non couverts (annulation hors délai, sync Legacy→V2, Terminal en parcours réel) — plutôt que de fabriquer une suite Playwright qui n'aurait rien à piloter.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Ne pas creuser au-delà d'écrire les tests de concurrence/résilience demandés | Aurait laissé un vrai bug de double-effet en production — l'esprit du CDC §67/§68 est de *garantir* l'absence de perte silencieuse, pas seulement de la documenter comme risque théorique |
| Restructurer plus largement `CheckoutService` pour une architecture "réservation + saga" complète | Risque de régression bien plus large sur le chemin financier le plus testé et le plus critique du projet, pour un gain marginal par rapport à la réclamation atomique ciblée |
| Fabriquer un token CSRF dédié en plus de `SameSite=lax` | Aucun frontend cross-origin n'existe ni n'est prévu à ce stade ; `SameSite=lax` est la mitigation standard pour une architecture même-origine — à revisiter si l'architecture change |
| Estimer un RPO/RTO de production sans le valider avec le club | Le CDC demande de les *documenter*, une estimation non validée aurait été une hypothèse silencieuse (CDC §111) présentée comme une décision |

## Conséquences

**Positif :** deux bugs de concurrence réels et un bug de résilience réel trouvés et corrigés (pas seulement des tests qui passent par construction). 16 nouveaux tests dédiés (concurrence, résilience, `AlertsService`, annulation hors délai), 177 au total. `helmet`/`cors`/rate limiting comblent des manques réels de la checklist §59. Backup/restore validé par un test réel, pas une simple description. Cohorte pilote fonctionnelle. Mapping E2E honnête plutôt qu'une suite Playwright vide de sens sans frontend.

**Négatif / dette assumée :** RPO/RTO restent des propositions à valider avec le club, pas des garanties de production (pas de sauvegarde automatique récurrente à ce stade). Monitoring/alertes (§57.4) limité à un endpoint `GET /admin/alerts` calculé à la demande — aucune intégration de paging réelle (Slack/PagerDuty), aucun fournisseur choisi. V-018 à V-024 (comptabilité/TVA crédits, validation juridique du frais SPLIT) restent des points de validation métier/juridique externes au code, non résolus par ce lot — comme documenté depuis le CDC §100 lui-même ("ne doivent pas bloquer le développement des modules indépendants"). 3 scénarios E2E non couverts (annulation hors délai — gap à combler rapidement ; sync Legacy→V2 — jamais construite ; Terminal en parcours réel — nécessite un compte Stripe réel).
