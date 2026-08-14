# ADR 0016 — Contrôle d'accès et notifications (Lot 8)

## Statut
Accepté

## Date
2026-08-14

## Contexte

Le CDC §34-§37 décrit deux mécanismes indépendants qui convergent au même endroit : le module `Automation` (§36), déclenché en aval de la confirmation/annulation d'une réservation.

1. **Codes d'accès** (§34) — un code `NNNN#` par réservation, généré aléatoirement, anti-collision sur une fenêtre temporelle chevauchante, coexistant pendant Dual Run avec les codes déjà attribués par Doinsport (§35, §78).
2. **Notifications** (§37) — un outbox durable : un e-mail temporairement indisponible ne doit jamais annuler ou masquer la transaction métier qui l'a déclenché (§37.3).

Aucun vendeur de matériel de contrôle d'accès n'est choisi pour Ardenne Padel, et aucune infrastructure de job durable (pg-boss) n'est encore introduite — deux limitations déjà annoncées dans PLAN_ACTION.md dès les Lots 5-7.

## Décision

### 1. `AccessProvider` — `LocalAccessProvider` n'est pas un stub d'erreur

Contrairement à `UnconfiguredPaymentProvider`/`UnconfiguredTerminalProvider` (ADR-0010, ADR-0014), qui répondent 503 tant qu'aucun compte Stripe n'existe, `LocalAccessProvider` est une implémentation **fonctionnelle et définitive** tant qu'aucun lecteur/serrure n'est connecté : un code `NNNN#` reste utilisable manuellement par le personnel du club sans aucune intégration matérielle. Le domaine ne connaît jamais le vendeur (CDC §34.5) — remplacer `LocalAccessProvider` par une implémentation matérielle réelle ne touchera ni `AccessGrantService` ni les points d'appel dans `CheckoutService`/`BookingsService`.

### 2. Le code est chiffré avec une clé dérivée d'un secret existant, pas un nouveau secret à provisionner

CDC §34.4 : "code chiffré ou protégé". Plutôt qu'introduire un `ACCESS_CODE_ENCRYPTION_KEY` de plus à générer/faire tourner, `access-code-crypto.ts` dérive la clé AES-256-GCM de `SESSION_SECRET` via `scrypt` avec un contexte fixe (`"ardenne-access-code-v1"`) — même logique que la réutilisation de `generateOpaqueToken`/`hashToken` pour les clés de dispositifs kiosque (Lot 7). Le code est déchiffré uniquement au moment de l'affichage à l'organisateur (`GET /bookings/:id/access`) ou de l'appel au provider — jamais loggé, jamais exposé ailleurs.

### 3. Coexistence Legacy : `createBookingInLegacy` retourne les `accessCodes`, `AccessGrantService` décide

`LegacyBookingDto.accessCodes` existait déjà depuis le Lot 2 (jamais consommé jusqu'ici). `createBookingInLegacy` (Lot 3) retourne désormais ces codes ; `CheckoutService`/`SplitCheckoutService` les transmettent à `AccessGrantService.provisionOrImportForBooking(booking, legacyAccessCodes)`, seul point de décision : si Doinsport a déjà attribué un ou plusieurs codes (et `LEGACY_ACCESS_IMPORT_ENABLED`), ils sont importés tels quels (`origin: LEGACY_IMPORTED`) et **aucun code V2 n'est généré pour la même réservation** — jamais deux codes concurrents pour le même utilisateur V2 (CDC §78). C'est le seul chemin de code réellement exercé (une réservation V2 synchronisée vers Legacy) ; l'import pour une réservation créée directement côté Doinsport puis visible en V2 n'existe pas encore (aucune synchronisation Legacy→V2 n'a été construite à aucun lot — hors périmètre).

### 4. Le module `Automation` (§36) n'est pas un bus d'événements — ce sont des appels directs, non bloquants

Comme pour le webhook Stripe (ADR-0010 §5) et le QR handoff (ADR-0014), aucune infrastructure de jobs n'existe. `AccessGrantService.provisionOrImportForBooking`/`revokeForBooking` et `NotificationService.enqueue` sont appelés directement depuis les points de convergence déjà identifiés dans les lots précédents (`CheckoutService.proceedAfterAuthorization`, `SplitCheckoutService.checkout`, `BookingsService.cancelBooking`), toujours après la transition d'état qui compte (`CONFIRMED`/`CANCELED`), jamais avant, et toujours enveloppés dans un `.catch()` qui logue sans propager : un échec de provisioning d'accès ou d'enqueue de notification ne fait jamais échouer une confirmation ou une annulation de réservation déjà actée.

### 5. `NotificationOutbox` : persister d'abord, envoyer ensuite, séparément

`NotificationService.enqueue` écrit toujours la ligne `PENDING` en base avant toute tentative d'envoi — c'est la garantie du §37.3. `dispatchDue` est une tentative séparée, sans garantie de succès : un échec incrémente `attempts`/`lastError` et laisse la ligne `PENDING` (donc rejouable) jusqu'à `MAX_DISPATCH_ATTEMPTS` (5), au-delà de quoi elle passe `FAILED` (reprise manuelle). Comme il n'existe pas de scheduler, `dispatchDue` est déclenché par une route admin (`POST /admin/notifications/dispatch-due`) plutôt que par un cron — dette assumée, à remplacer par pg-boss quand cette infrastructure sera introduite.

### 6. `EmailSender.sendTemplatedEmail` généralise sans casser l'existant

Les canaux déjà en place (vérification de compte, reset mot de passe, invitation SPLIT) restent des méthodes dédiées de `EmailSender` — non migrés vers l'outbox dans ce lot, pour ne pas risquer de régression sur des parcours déjà testés en profondeur (Lots 1 et 6). Seuls les nouveaux templates (§37.1 : confirmation réservation, rappel, annulation, remboursement, achat de crédits, wallet crédité, paiement de part confirmé) passent par l'outbox. `sendTemplatedEmail(to, template, payload)` est la méthode générique appelée par `NotificationDispatcher` ; `DevConsoleEmailSender` l'implémente par un simple `console.log`, cohérent avec l'absence de fournisseur e-mail réel (`NOTIFICATION_PROVIDER` non configuré).

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Un seul modèle `AccessProvider` = stub d'erreur (comme Stripe) tant qu'aucun vendeur n'est choisi | Un code d'accès reste utile même sans matériel connecté (usage manuel au comptoir) — contrairement à un paiement, qui ne peut pas fonctionner "manuellement" |
| Introduire un nouveau secret dédié pour chiffrer les codes | Surface de secrets à gérer/faire tourner en plus, sans bénéfice de sécurité réel par rapport à une dérivation depuis `SESSION_SECRET` |
| Migrer tous les e-mails existants (vérification, invitation SPLIT) vers l'outbox dans ce lot | Risque de régression sur des flux déjà validés en profondeur, pour un gain immédiat marginal (ils fonctionnent déjà) ; laissé en dette explicite |
| Bloquer la confirmation de réservation si le provisioning d'accès échoue | Contraire à l'esprit CDC §36 : l'accès est un automatisme en aval du paiement, jamais une condition du paiement lui-même |
| Introduire pg-boss dans ce lot pour un vrai scheduler de notifications | Aurait élargi le lot à une dépendance d'infrastructure lourde, alors que l'outbox seule satisfait déjà la garantie de durabilité du §37.3 ; le déclenchement reste manuel en attendant |

## Conséquences

**Positif :** génération/révocation de codes d'accès et coexistence Legacy entièrement développées et testées (14 tests dédiés, 132 au total), branchées dans les trois points de convergence existants sans toucher à leur logique de paiement. Outbox de notifications fonctionnel et durable, avec retry borné et reprise manuelle. Vérifié manuellement : `GET /bookings/:id/access` répond 401/403 correctement selon l'auth, `POST /admin/notifications/dispatch-due` gardé ADMIN, dégradation cohérente avec l'absence de compte Stripe (les parcours qui dépendent d'une confirmation de paiement pour déclencher l'accès/la notification ne peuvent être vérifiés en direct tant que Stripe n'est pas configuré — même limitation que documentée depuis l'ADR-0010).

**Négatif / dette assumée :** pas de synchronisation Legacy→V2 pour l'import de codes d'une réservation créée directement côté Doinsport (aucun lot n'a construit cette direction de synchronisation). `dispatchDue` reste déclenché manuellement, pas de vrai scheduler. Les templates existants (vérification, invitation SPLIT) ne passent pas encore par l'outbox — deux mécanismes de notification coexistent, à unifier lors de l'introduction de pg-boss. Monitoring "device offline" pour l'accès (symétrique à `KioskDeviceService.isOffline`, CDC §39.3) non exposé par un endpoint dédié.
