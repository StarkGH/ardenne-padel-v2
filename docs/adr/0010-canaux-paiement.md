# ADR 0010 — Canal de paiement ONLINE (Stripe)

## Statut
Accepté pour le canal ONLINE. QR_HANDOFF et TERMINAL tranchés au Lot 7 — voir [ADR-0014](./0014-kiosque-stripe-terminal.md).

## Date
2026-08-14

## Contexte

Le CDC §21.1/§22 impose une abstraction `PaymentProvider` derrière laquelle le domaine Booking ne connaît jamais le SDK Stripe. Contrainte spécifique à cette session : **aucun compte Stripe n'existe encore pour Ardenne Padel** (confirmé explicitement par l'utilisateur) — impossible de valider l'intégration en conditions réelles comme cela a été fait pour Doinsport au Lot 2. Il fallait développer un Lot 4 complet et testé sans dépendre de clés API réelles.

## Décision

### 1. `StripeClientPort` — sous-ensemble minimal du SDK, pas le SDK entier

Plutôt que d'importer le type `Stripe` complet partout, une interface étroite (`stripe-client-port.ts`) déclare uniquement les 6 méthodes réellement utilisées (`customers.create`, `paymentIntents.{create,capture,cancel,retrieve}`, `refunds.create`, `balanceTransactions.retrieve`, `webhooks.constructEvent`). `createRealStripeClient()` adapte explicitement le vrai SDK vers ce port (pas de cast structurel risqué). Conséquence directe : `StripePaymentProvider` est testable unitairement avec un faux client simple (`stripe-payment-provider.test.ts`), sans clé API, sans réseau.

### 2. Capture manuelle (autoriser avant Legacy, capturer après) — CDC §27.1

`createPayment` crée systématiquement un PaymentIntent en `capture_method: "manual"` avec confirmation immédiate. C'est la seule façon de respecter fidèlement la séquence du CDC : l'argent n'est jamais prélevé avant que Doinsport ait confirmé la réservation. `voidAuthorization` (extension au-delà de la liste minimale du CDC §21.1) permet de libérer l'autorisation en cas de collision — sans elle, l'orchestration ne pourrait pas suivre le diagramme §27.1 tel que décrit.

### 3. `UnconfiguredPaymentProvider` — dégrader proprement, ne jamais crasher

Tant que `STRIPE_SECRET_KEY` est absent (cas actuel), l'application démarre normalement et tous les autres modules fonctionnent. Seuls les appels de paiement échouent avec un code `STRIPE_NOT_CONFIGURED` (503) explicite. **Validé manuellement** : serveur démarré sans clé, `POST /bookings` fonctionne, `POST /payments/checkout` répond 503 proprement, `POST /webhooks/stripe` répond 400 sans clé de signature.

### 4. Deux points d'entrée convergent vers une seule suite (`proceedAfterAuthorization`)

Le paiement peut être confirmé immédiatement (carte simple, `requires_capture`) ou nécessiter une authentification forte (`requires_action`, 3D Secure). Dans les deux cas, la suite (création Legacy puis capture) passe par la même fonction privée — invoquée soit de façon synchrone dans `checkout()`, soit de façon asynchrone depuis le webhook (`continueAfterAuthorizationConfirmed`). Il n'existe qu'un seul chemin vers `CONFIRMED`, jamais deux implémentations divergentes.

### 5. Webhook synchrone (pas encore de job) — dette assumée

Le CDC §44 demande de "répondre rapidement, déléguer le traitement lourd à un job". pg-boss n'est pas encore introduit (prévu Lot 7/8). Le traitement webhook reste donc synchrone pour ce lot — acceptable tant que le volume est nul (pas de compte Stripe actif). Dédup stricte par `event_id` (`webhook_events`) déjà en place, donc aucun risque de double effet même sans file de jobs.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Capture automatique (`capture_method: "automatic"`) | Prélèverait l'argent avant confirmation Doinsport — contraire à CDC §27.1 |
| Caster directement le SDK Stripe vers `PaymentProvider` | Couplage fort au SDK dans tout le domaine, non testable sans clé, contraire à CDC §21.1 |
| Bloquer le Lot 4 en attendant un compte Stripe réel | Aurait immobilisé tout le reste du plan sur une dépendance externe hors du contrôle du développement ; le CDC §112 privilégie la progression testable et réversible |
| Faire planter le démarrage si `STRIPE_SECRET_KEY` est absent | Empêcherait de développer/tester les Lots 5+ (wallet, split, etc.) qui ne dépendent pas tous de Stripe |

## Conséquences

**Positif :** Lot 4 entièrement développé et testé (39 tests dédiés paiement/orchestration) sans bloquer sur l'absence de compte Stripe. Le jour où de vraies clés seront fournies, seule la configuration change — aucun code métier à toucher.

**Négatif / dette assumée :** aucune validation live contre l'API Stripe réelle dans cette session (contrairement à Doinsport au Lot 2) — les points V-011 à V-017 du CDC (§100) restent explicitement ouverts et devront être revalidés avant tout pilote réel, avec de vraies clés de test.
