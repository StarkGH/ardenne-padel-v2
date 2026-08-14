# ADR 0014 — Kiosque QR et intégration Stripe Terminal

## Statut
Accepté

## Date
2026-08-14

## Contexte

Le CDC §22.2/§22.3-§22.4/§22.6/§43/§54.1/§59.2 décrit deux mécanismes distincts au comptoir/sur tablette :

1. **QR handoff** — un client se présente au club, choisit un créneau sur une tablette kiosque, scanne un QR sur son smartphone pour reprendre "exactement le checkout en cours" et payer depuis son propre compte.
2. **Terminal Stripe** — un lecteur de carte physique (`card_present`) pour le paiement en personne, sur place, sans passer par un téléphone.

Même contrainte que l'ADR-0010 : **aucun compte Stripe** n'existe encore. Le QR handoff ne dépend pas de Stripe (transport d'un créneau, pas d'argent) et est donc entièrement développable et testable dès ce lot. Terminal, en revanche, ne peut être validé qu'avec un vrai compte et un lecteur physique — ce lot pose ses fondations sans les activer.

## Décision

### 1. Un device kiosque = un secret durable, jamais un compte utilisateur

`KioskDevice` est une entité à part entière (CDC §22.6), authentifiée par une clé opaque hashée (`deviceKeyHash`, même schéma que les tokens d'identity — `generateOpaqueToken`/`hashToken`). La clé brute n'est retournée qu'une fois, à l'enregistrement (`POST /admin/kiosk-devices`, réservé ADMIN). `requireKioskAuth` est un middleware distinct de `requireAuth` : un kiosque n'est jamais un utilisateur authentifié, il n'a pas de rôle ni de session — c'est la distinction que fait le CDC §59.2 ("les clients à distance ne voient pas les actions Terminal").

### 2. Le QR ne transporte jamais que la référence à une session serveur

`KioskCheckoutSession` porte uniquement `courtId`/`startAt`/`durationMinutes`/`paymentMode` — jamais de donnée bancaire ni de moyen de paiement (CDC §22.2 : "Le QR ne doit jamais embarquer de donnée bancaire ou secret durable"). Le token scanné est un token opaque à usage unique (même primitive que les autres tokens de l'application), TTL configurable (`KIOSK_SESSION_TTL_MINUTES`, défaut 10 min).

### 3. Pas d'endpoint de réclamation séparé — la réclamation est un effet de bord de la consultation authentifiée

Le CDC §43 ne liste pas d'endpoint `POST .../claim` distinct : `GET /kiosk/checkout-sessions/:token` sert à la fois de prévisualisation (visiteur non authentifié : consultation seule, CDC §18.2) et de réclamation (utilisateur authentifié + session `PENDING` : réclame la session, crée la réservation via `BookingsService.createBooking`, et renvoie directement la réservation créée). Une deuxième consultation authentifiée sur une session déjà `CLAIMED` ne recrée jamais de réservation — elle retombe sur la branche de prévisualisation, qui affiche simplement le statut courant. La réclamation elle-même reste atomique côté repository (`claimIfPending`, `updateMany` conditionné sur `status = PENDING`) pour empêcher une double réclamation en cas de scan concurrent.

### 4. Terminal : abstraction posée, **non câblée dans l'orchestration de checkout**

`TerminalProvider` (`createConnectionToken`, `createPaymentIntent`, `capturePaymentIntent`, `cancelPaymentIntent`) est une interface séparée de `PaymentProvider` — le canal `TERMINAL` (`card_present`) n'est jamais confondu avec le canal `ONLINE`, une garantie explicite du CDC §22.3-§22.4 (un paiement ONLINE ne doit jamais pouvoir être reclassé `card_present` après coup, et inversement). `StripeTerminalProvider` réutilise la même discipline de capture manuelle que le canal ONLINE (CDC §27.1). Les endpoints `POST /terminal/connection-token`, `POST /terminal/payment-intents`, `GET /terminal/devices` sont montés et fonctionnels, mais **aucun flux de réservation ne les invoque encore** : il n'existe pas encore de "TerminalCheckoutService" équivalent à `CheckoutService`. Câbler Terminal dans l'orchestration de bout en bout exigerait de valider le comportement réel d'un lecteur physique (statuts `waiting_for_input`, annulation matérielle, timeouts) — hors de portée sans compte Stripe ni lecteur. `UnconfiguredTerminalProvider` (symétrique de `UnconfiguredPaymentProvider`, ADR-0010) garantit une dégradation propre (503 `STRIPE_NOT_CONFIGURED`) tant que `STRIPE_SECRET_KEY` est absent.

### 5. Authentification Terminal réutilise `requireKioskAuth`

Le CDC §59.2 traite Terminal comme du matériel de club, jamais accessible à distance par un client. Plutôt que d'introduire un troisième mécanisme d'authentification, les endpoints `/terminal/*` sont gardés par le même `requireKioskAuth` que le QR handoff — un kiosque physique enregistré peut légitimement piloter un lecteur de carte qui lui est associé. `TerminalDevice` reste un enregistrement séparé de `KioskDevice` (un lecteur de carte n'est pas une tablette), mais partage le même modèle de confiance.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Endpoint `POST /kiosk/checkout-sessions/:token/claim` séparé | Non listé au CDC §43 ; la consultation authentifiée suffit et évite un aller-retour HTTP supplémentaire sur un parcours déjà contraint en temps (TTL court) |
| Authentifier Terminal comme un utilisateur (JWT client) | Contraire au CDC §59.2 — un lecteur de carte n'a pas d'identité utilisateur, seulement une identité de dispositif club |
| Câbler `TerminalProvider` dans `CheckoutService` dès ce lot | Aucun moyen de valider en conditions réelles (pas de compte Stripe, pas de lecteur physique) ; risquerait de figer une orchestration non testée en pratique — mieux vaut poser l'abstraction et différer le câblage (V-014, CDC §100) |
| Un seul modèle `Device` pour kiosque et Terminal | Les cycles de vie diffèrent (un kiosque authentifie des requêtes HTTP, un Terminal est piloté par le SDK Stripe côté device) ; les CDC §22.6 et §22.3-4 les traitent comme deux catalogues distincts |

## Conséquences

**Positif :** parcours QR handoff entièrement développé et testé (12 tests dédiés, service + intégration base réelle) sans dépendre de Stripe. Vérifié manuellement de bout en bout : enregistrement de dispositif, création de session, prévisualisation non authentifiée, réclamation authentifiée avec création de réservation, anti-réutilisation, dégradation propre 503 sur `/terminal/connection-token` sans clé Stripe, 401 sur les endpoints Terminal sans authentification kiosque.

**Négatif / dette assumée :** Terminal reste une coquille non intégrée à un parcours de réservation réel — aucun `TerminalCheckoutService` n'existe. Le câblage complet (associer un paiement Terminal à une réservation, gérer les statuts intermédiaires du lecteur, réconcilier avec `Payment`) est différé à une session ultérieure avec un compte Stripe réel et un lecteur physique (V-014, CDC §100). `KioskCheckoutSession.status` ne transite jamais vers `COMPLETED` dans ce lot — cette transition dépend du paiement effectif de la réservation créée, hors périmètre du module kiosque lui-même.
