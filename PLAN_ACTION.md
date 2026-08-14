# Plan d'action — Développement Ardenne Padel V2

Basé sur le cahier des charges v1.1 (13 août 2026). Ce plan détaille, lot par lot, les tâches, livrables, tests et critères de sortie nécessaires pour développer l'intégralité de la plateforme décrite, du dossier de projet jusqu'au cutover de Doinsport.

Règle de progression (CDC §92) : un lot n'est considéré terminé que s'il compile, passe ses tests, inclut ses migrations DB, met à jour la documentation, et ne casse aucun test des lots précédents. Stripe et Doinsport sont intégrés dès les premiers lots concernés — pas en fin de projet.

Estimations données pour une petite équipe (1 à 2 développeurs full-stack + support ponctuel). À ajuster selon les ressources réellement allouées.

---

## Lot 0 — Dossier de projet (fait)

**Objectif.** Disposer d'un dossier de projet exploitable avant toute ligne de code applicatif.

**Livrables produits dans cette session :**
- Structure de repository conforme au CDC §71 (`apps/web`, `apps/api/src/modules/*`, `packages/*`, `docs/*`, `openapi/`, `scripts/`)
- `README.md`, `.env.example` (feature flags et secrets couverts)
- `docs/architecture.md`, `docs/migration.md`
- 15 ADR obligatoires (§70) créés en statut "Proposé", à trancher au fil des lots
- CDC et `API-CATALOG.md` copiés dans `docs/` comme source de vérité versionnée
- Ce plan d'action

**Constat important :** un repository d'audit Doinsport existe déjà (`padel-service/`, dossier voisin) avec du code fonctionnel (`doinsport.js`, `court-map.js`, `booking-db.js`, `sync.js`, etc.) et les UUID réels des 4 terrains/activités. Ce code est réutilisable et ne doit pas être réécrit à l'aveugle (CDC §72) : il sera encapsulé au Lot 2, pas jeté.

**Gate de sortie :** validé — dossier disponible pour revue.

---

## Lot 1 — Fondations

**Statut : en cours.** Fait : monorepo npm workspaces, `packages/{shared,config,domain}`, Prisma + PostgreSQL, module `identity` complet (register/login/logout/logout-all/verify-email/password reset), RBAC de base (`requireRole`), logs structurés, config typée avec validation au démarrage, 18 tests (unitaires + intégration réelle sur DB) verts, `tsc` strict sans erreur, parcours testé manuellement de bout en bout via l'API démarrée. Restant : pipeline CI (dépend de l'initialisation git — pas encore fait), lint réellement exécuté en continu (config posée, pas encore intégrée à un hook), module `users` distinct (profil au-delà de `/auth/me` — actuellement fusionné dans `identity`, à séparer si besoin au moment du Lot 3).

**Objectif.** Poser le socle technique commun à tous les modules futurs.

**Tâches :**
- Initialiser le monorepo (workspaces, tooling TS strict, lint/format, CI basique)
- `docker-compose` pour PostgreSQL local + service API
- Système de migrations DB versionnées
- Module `identity` : inscription, connexion e-mail/mot de passe (hash moderne), vérification e-mail, reset mot de passe, session sécurisée, déconnexion globale
- Modèle `users` minimal (CDC §7.1) + rôles `CUSTOMER/STAFF/ADMIN/SUPER_ADMIN` (§8) avec RBAC
- Configuration typée + feature flags serveur-side (§63, §90)
- Logs structurés (§57.1) sans données sensibles
- Squelette de tests unitaires/intégration + pipeline CI

**Livrables :** API bootée avec auth fonctionnelle, RBAC, config typée, `README.md` "démarrage" complété.

**Tests requis :** auth (register/login/reset/logout all sessions), RBAC par rôle, validation input.

**Gate de sortie :** un développeur externe peut cloner, configurer `.env`, lancer DB + API, et s'authentifier en suivant uniquement le README.

**Durée indicative : 2–3 semaines.**

---

## Lot 2 — Legacy adapter (Doinsport)

**Statut : cœur de l'adapter fait et validé en conditions réelles.** Fait : interface `LegacyBookingProvider` complète, `LegacyDoinsportAdapter` (auth, listClients, listBookings avec refiltrage local, getBooking, listCourts, resolveLegacyPrice, createBooking, cancelBooking), résolveur `userClubId` robuste (V-008 résolu et vérifié en direct), résolveur de prix porté et testé par fixtures (résultat identique au cas réel documenté), mapping d'erreurs HTTP→codes V2, tables `courts`/`legacy_court_mapping`/`legacy_clients`/`legacy_booking_mappings`/`legacy_auth_tokens`, seed des 4 terrains avec UUID vérifiés en direct. Validé en live : authentification, listing terrains, résolution de prix réelle (résultat identique à `API-CATALOG.md`). Restant : tests d'écriture réels (`createBooking`/`cancelBooking`, à faire prudemment sur un créneau de test dédié, CDC §94), synchronisation périodique et réconciliation (dépendent de pg-boss, pas encore introduit), workflow complet d'idempotence après timeout (§16.2).

**Objectif.** Encapsuler Doinsport derrière `LegacyDoinsportAdapter` implémentant `LegacyBookingProvider`, sans laisser fuiter les structures Legacy dans le reste du code.

**Tâches :**
- Écrire des tests de caractérisation sur le comportement actuel de `padel-service/doinsport.js`, `refresh-doin-token.js`, `court-map.js`, `booking-db.js`, `sync.js` avant tout refactor
- Porter dans `modules/legacy-doinsport` : `authenticateClub`, `listClients`, `listBookings`, `getBooking`, `listCourts`, `resolveLegacyPrice`, `createBooking`, `cancelBooking`
- Résoudre l'ambiguïté `userClubId` (JWT vs variable d'environnement) — valider au démarrage, ne pas hardcoder (V-008)
- Réappliquer localement le filtre temporel du listing (filtres `startAt` non fiables côté Doinsport)
- Implémenter le resolver de prix Legacy audité (timetables → blocks → tri par `createdAt` → durée) **isolé**, sans contaminer le futur moteur tarifaire V2
- Tables de mapping : `legacy_court_mapping` (seedée avec les UUID déjà connus via `court-map.js`), `legacy_user_mapping`, `legacy_booking_mapping`
- Mapping d'erreurs HTTP Legacy → codes V2 (§87)

**Tests requis (§65) :** auth, refresh 401 + 1 retry, clients, bookings, detail, courts, prices, resolver timetable, create, collision 422, cancel, timeout simulé, marqueur de corrélation.

**Points à valider avant d'aller plus loin (§100, Legacy) :** V-001 (`withRefund:false`), V-002 (marqueur `APV2`), V-006 (rate limiting, observation sans stress test), V-007 (stratégie shadow import), V-008 (`userClubId`), V-009 (timezone/DST), V-010 (comparaison prix Legacy/V2 — sera complétée au Lot 3).

**Gate de sortie :** l'adapter passe tous ses tests de contrat, aucune structure Doinsport n'est visible en dehors du module.

**Durée indicative : 2–3 semaines.**

---

## Lot 3 — Booking core

**Statut : gate de sortie atteint et vérifié manuellement.** Fait : modules `availability` (calcul pur testé + orchestration Dual Run documentée dans ADR-0003), `pricing` (moteur V2 déterministe, priorité explicite), `bookings` (machine à états complète, orchestration CDC §27 avec paiement simulé — ADR-0004, comparaison prix V2/Legacy avec log `PriceMismatch`). 61 tests (dont un faux `LegacyBookingProvider` couvrant succès/collision/erreur/lien Legacy manquant). Vérifié manuellement de bout en bout via le serveur réel : disponibilité → devis (72,00 € Padel 3/90min) → connexion → réservation `CONFIRMED`/`PAID`, sans toucher Doinsport (`LEGACY_WRITE_ENABLED=false`). Restant : endpoints participants (`POST/DELETE .../participants`), recherche joueurs + `friendship` (modèle en base, service/routes pas encore écrits), panier de réservation survivant à l'authentification tardive (§18.2, nécessite un état côté frontend qui n'existe pas encore), protection anti-double-réservation locale quand Legacy est désactivé.

**Objectif.** Cœur métier réservation, indépendant de tout provider de paiement.

**Tâches :**
- `courts` (4 terrains, capacité simple=2/double=4, jamais de logique basée sur le nom)
- `availability` : `OpeningRule`, `CourtClosure`, `DurationRule`, consultation sans connexion
- `pricing` : moteur `TariffRule` local (validité, priorité explicite, résolution déterministe — jamais basé sur `createdAt`)
- Comparaison prix V2 vs prix Legacy avec `PRICE_MISMATCH` loggé si écart hors tolérance (V-010)
- Machine à états `bookings` complète (§17) : statuts principaux, sous-état sync Legacy, sous-état paiement
- Recherche joueurs (V2 + Shadow Clients, sans exposer e-mail/téléphone publiquement) et modèle `friendship` basique
- Panier de réservation qui survit à une authentification tardive (§18.2)
- Orchestration Dual Run booking ↔ Legacy pour le cas carte/hold (§27.1) — le cas paiement complet online sera branché au Lot 4

**Tests requis :** résolution prix, state machine, disponibilité sous Dual Run (aucune source ne doit occuper le créneau), collision → message utilisateur dédié.

**Gate de sortie :** un créneau peut être consulté, sélectionné, et une réservation `DRAFT → CHECKOUT_PENDING` créée de bout en bout côté V2+Legacy, sans paiement réel (paiement simulé/mock à ce stade).

**Durée indicative : 3 semaines.**

---

## Lot 4 — Payments online / FULL

**Statut : développé et testé sans clé Stripe réelle (aucun compte Stripe pour Ardenne Padel à ce jour — confirmé explicitement) — validation live reportée, V-011 à V-017 restent ouverts.** Fait : interface `PaymentProvider` (CDC §21.1) + `StripePaymentProvider` (port SDK étroit, testable sans réseau), orchestration complète CDC §27.1 (autoriser -> créer Legacy -> capturer, avec void sur collision, MANUAL_REVIEW sur erreur ambiguë sans jamais voider aveuglément), webhook Stripe avec dédup stricte par `event_id`, remboursement total/partiel avec traçabilité (CDC §30.1), `UnconfiguredPaymentProvider` pour dégrader proprement (503) tant qu'aucune clé n'est configurée. `BookingsService.createBooking` s'arrête maintenant à `CHECKOUT_PENDING` ; `POST /payments/checkout` complète l'orchestration — reflète les deux endpoints du CDC §43. 39 tests dédiés paiement/orchestration (dont capture différée après 3D Secure via webhook, idempotence webhook). Vérifié manuellement : serveur démarre sans clé Stripe, réservation créée normalement, checkout échoue proprement en 503, webhook rejette une requête sans signature en 400. Restant : capture réelle du coût provider en conditions réelles, endpoints `/payments/setup` et gestion des moyens de paiement enregistrés (`GET/DELETE /me/payment-methods`), intégration du remboursement dans le flux d'annulation (§29.3).

**Objectif.** Premier parcours de paiement réel : Stripe online, mode `FULL`.

**Tâches :**
- Interface `PaymentProvider` + `StripePaymentProvider`
- Stripe Customers, Payment Element/Checkout, moyens locaux activables
- Orchestration paiement + booking Legacy complète (§27.1 carte avec autorisation préalable, §27.2 moyens à paiement immédiat sans hold)
- Endpoint webhook `POST /api/v1/webhooks/stripe` : vérification signature, déduplication par `event_id`, traitement idempotent délégué à un job
- Refunds (total/partiel), traçabilité (§30.1)
- Capture asynchrone du coût provider réel (`provider_fee_cents`, `provider_net_cents`, `provider_balance_transaction_id`)
- `payments` table complète avec `payment_channel`/`payment_method_type`

**Tests requis (§65) :** carte succès/refus, authentification forte, moyen local avec redirection, webhook dupliqué, refund, SetupIntent, off-session succès/échec, récupération coût réel.

**Points à valider (V-011, V-012, V-017).**

**Gate de sortie :** E2E-001 (utilisateur neuf, simple, FULL online, confirmation) passe en staging avec Stripe test et Doinsport test contrôlé.

**Durée indicative : 3 semaines.**

---

## Lot 5 — Wallet / crédits prépayés

**Statut : fait et testé (toujours sans clé Stripe réelle pour l'achat de packs — mêmes limites que le Lot 4).** Fait : `wallet_accounts`/`wallet_transactions` (ledger append-only, jamais `balance += x`) avec solde dérivé par agrégation, `wallet_holds` avec transitions atomiques anti-double-capture/libération (CDC §47.2.bis), `credit_packs`/`credit_pack_purchases` avec crédit idempotent garanti par transition d'état atomique, consommation bonus-first, remboursement proportionnel à la composition d'origine (§28.10). Paiement 100% wallet et paiement mixte wallet+carte unifiés dans `CheckoutService` (même orchestration Legacy que le Lot 4, symétrie hold wallet / autorisation Stripe). 25 tests dédiés, 95 au total. Vérifié manuellement : wallet auto-créé au premier accès, liste des packs, achat échoue proprement en 503 sans clé Stripe. ADR-0007 actée. Restant : reporting `prepaid_balance_liability`, politique d'expiration du bonus (dépend de l'infra de jobs, Lot 7/8), intégration automatique du remboursement wallet dans l'annulation de réservation (Lot 9), recharge via Terminal/QR (Lot 7), base de test isolée (constat documenté dans `docs/operations.md`, pas encore corrigé).

**Objectif.** Wallet fermé avec ledger append-only, comme moyen de paiement de premier rang.

**Tâches :**
- `wallet_accounts`, `wallet_transactions` (ledger, jamais `balance += x`), `wallet_holds`
- `credit_packs` configurables (aucun taux hardcodé), `credit_pack_purchases`
- Recharge online / Terminal / QR / crédit manuel admin
- Distinction crédits `PAID` vs `BONUS` vs `ADMIN_COMP`, politiques d'expiration
- Paiement 100% wallet et paiement mixte wallet + externe
- Reporting `prepaid_balance_liability`

**Tests requis :** ledger, crédit unique par achat (anti double-crédit sur webhook retry), bonus, hold create/release/capture, remboursement wallet (restitution composition payé/bonus).

**Points à valider (V-018 comptabilité/TVA, V-019 CGV, V-020 bonus, V-021 concurrence hold).**

**Gate de sortie :** E2E-002 (double, 4 participants, FULL wallet), E2E-012/E2E-013 (wallet total / partiel), E2E-014/E2E-015 (achat pack, achat pack + bonus) passent.

**Durée indicative : 2–3 semaines.**

---

## Lot 6 — SPLIT (paiement partagé)

**Statut : fait et testé (toujours sans clé Stripe réelle).** Fait : `booking_shares`/`booking_guarantees` (CDC §25-§26), calcul des parts déterministe (`split-calculator.ts`, bonus-first n'existe pas ici mais frais ORGANIZER/PRO_RATA géré, centimes résiduels jamais perdus), garantie carte off-session ou wallet réservée (un seul mécanisme actif, §25.3), invitations par lien à usage unique, paiement d'une part via wallet ou carte, libération proportionnelle de la garantie à mesure des paiements, régularisation (capture du solde de garantie) disponible mais pas encore déclenchée automatiquement. Endpoints participants (`POST/DELETE .../participants`) et `POST /payments/setup` ajoutés (comblent des manques du Lot 3/Lot 4). 15 nouveaux tests, 108 au total. **Un vrai bug d'intégrité financière trouvé et corrigé en route** : la libération partielle de garantie ne réduisait pas le hold wallet sous-jacent (`balance_reserved` restait faux) — voir ADR-0012. Vérifié manuellement : réservation SPLIT créée, participant ajouté, checkout échoue proprement en 503 sans clé Stripe, lien de part invalide renvoie 404. ADR-0012 et ADR-0013 actées. Restant : reprise 3DS pour la part organisateur (le FULL l'a, pas le SPLIT), déclenchement automatique de la régularisation (Lot 7/8), validation juridique du wording/TVA du frais de service (V-022/V-023, bloquant avant activation commerciale réelle, pas avant le développement).

**Objectif.** Paiement par participant comme option secondaire, avec garantie organisateur et frais de service configurable.

**Tâches :**
- `booking_shares`, invitations par lien opaque à durée de vie limitée
- Frais de service SPLIT configurable (`split_service_fee_*`), snapshoté au moment du choix SPLIT, jamais présenté comme "frais Stripe/carte" (feature flag indépendant du split lui-même)
- `booking_guarantees` : `CARD_OFF_SESSION` (SetupIntent, consentement explicite) et `WALLET_RESERVE` (holds), un seul mécanisme actif par réservation
- Régularisation à échéance (débit différé ou capture de hold), notifications organisateur/admin en cas d'échec
- Remboursements multi-payeur, politique `REFUND_WITH_BOOKING` par défaut

**Tests requis :** calcul des parts (simple/double, centimes résiduels), garantie carte, garantie wallet, remboursements multi-payeur, idempotence des shares.

**Points à valider — juridiques avant activation commerciale (V-022, V-023, V-024) : wording du frais de répartition à faire valider pour ne jamais être assimilé à une surcharge pour paiement électronique (interdite en Belgique).**

**Gate de sortie :** E2E-003 à E2E-006 (split, frais affiché, invitations, régularisation carte, régularisation wallet) passent.

**Durée indicative : 3 semaines.**

---

## Lot 7 — Kiosque / Terminal

**Statut : fait et testé pour le QR handoff (sans compte Stripe — mêmes limites que les Lots 4-6). Terminal posé mais non câblé dans un parcours de réservation.** Fait : `kiosk_devices` (dispositif enregistré/révocable, clé opaque hashée jamais loggée) et `kiosk_checkout_sessions` (token opaque à usage unique, TTL configurable `KIOSK_SESSION_TTL_MINUTES`, réclamation atomique anti-double-scan). Parcours complet : création de session par le kiosque authentifié, prévisualisation publique par token, réclamation automatique dès qu'un utilisateur authentifié consulte le token (crée la réservation via `BookingsService`, pas d'endpoint de réclamation séparé — non listé au CDC §43), statut interrogeable par le kiosque, annulation. `terminal_devices` et `TerminalProvider` (interface + `StripeTerminalProvider`, même discipline de capture manuelle que le canal ONLINE, CDC §27.1) posés et testés unitairement (fake client Stripe), `UnconfiguredTerminalProvider` pour la dégradation propre (503) sans clé Stripe — mais **non câblés dans un `TerminalCheckoutService`** : aucun flux de réservation n'invoque encore un paiement Terminal réel, différé faute de compte Stripe et de lecteur physique (V-014). tests dédiés dispositif + session QR (enregistrement/authentification/révocation, création/scan/réclamation/anti-réutilisation/expiration/annulation) et Terminal (connexion, PaymentIntent, capture, annulation) ajoutés, 118 au total. **Un bug de tri non déterministe trouvé et corrigé en route** (hors périmètre kiosque, découvert via un test Lot 6 devenu intermittent) : `BookingShareService.createSharesAndInvite` insérait les 4 parts d'un SPLIT en un seul `createMany`, où Postgres évalue `now()` une seule fois pour tout le statement — les 4 lignes recevaient un `createdAt` implicite identique, rendant `orderBy: createdAt` non déterministe entre elles (`shares[0]`, censé être la part organisateur déjà payée, pouvait pointer vers une part participant `INVITED`). Corrigé par un `createdAt` explicite et strictement croissant. Vérifié manuellement de bout en bout (voir ADR-0014) : enregistrement de dispositif kiosque, création de session, prévisualisation non authentifiée, réclamation authentifiée avec création de réservation, `/terminal/connection-token` renvoie 503 proprement sans clé Stripe, `/terminal/devices` sans authentification kiosque renvoie 401. ADR-0014 actée (ADR-0010 mise à jour en conséquence). Restant : écran kiosque (frontend, hors périmètre backend de cette session), `TerminalCheckoutService` reliant un paiement Terminal à une réservation, recharge de crédits au bar via Terminal, monitoring offline (le calcul `isOffline` existe côté service mais n'est exposé par aucun endpoint/job), Tap to Pay (V-016, non tranché), validation E2E avec un vrai lecteur en staging (hors de portée sans compte Stripe).

**Objectif.** Parcours au club : tablette kiosque, Stripe Terminal, QR handoff.

**Tâches :**
- `kiosk_devices`, `kiosk_checkout_sessions` (token aléatoire, expiration courte, anti-réutilisation)
- Écran kiosque `[PAYER ICI] → Terminal` / `[CONTINUER SUR MON TÉLÉPHONE] → QR`
- Intégration Stripe Terminal (connexion lecteur, PaymentIntent Terminal, rattachement Customer/booking)
- Recharge de crédits au bar via Terminal
- Monitoring device (kiosk/terminal offline)
- Tap to Pay : uniquement si un client natif/kiosk compatible est décidé — sinon rester sur lecteur physique + QR (§22.5)

**Tests requis :** création/scan/reprise/expiration session QR, PaymentIntent Terminal succès/refus/annulation, association booking/Customer.

**Points à valider (V-014 Terminal, V-015 QR, V-016 Tap to Pay).**

**Gate de sortie :** E2E-021 à E2E-023 (kiosque Terminal, kiosque QR, QR expiré) passent avec un vrai lecteur en staging.

**Durée indicative : 2–3 semaines (dépend du matériel Stripe Terminal disponible).**

---

## Lot 8 — Access / Notifications

**Statut : fait et testé.** Fait : `access_grants` (code `NNNN#` généré cryptographiquement aléatoire, chiffré en base — clé dérivée de `SESSION_SECRET` via scrypt, jamais un nouveau secret à provisionner — anti-collision sur fenêtre temporelle chevauchante par zone d'accès), interface `AccessProvider` (`provisionGrant`/`updateGrant`/`revokeGrant`/`healthCheck`) découplée du matériel, `LocalAccessProvider` comme implémentation par défaut fonctionnelle (pas un stub d'erreur — un code reste utilisable manuellement sans matériel connecté, contrairement à Stripe). Coexistence `V2_GENERATED`/`LEGACY_IMPORTED` (CDC §35/§78) : `createBookingInLegacy` remonte désormais les `accessCodes` Doinsport (champ présent depuis le Lot 2, jamais consommé jusqu'ici) ; `AccessGrantService` importe le code Legacy plutôt que d'en générer un V2 concurrent quand `LEGACY_ACCESS_IMPORT_ENABLED` est actif. `notification_outbox` durable (CDC §37.3) : `NotificationService.enqueue` persiste toujours avant tout envoi, `dispatchDue` tente l'envoi séparément (retry borné à 5 tentatives puis `FAILED`, reprise manuelle via `POST /admin/notifications/dispatch-due` — pas encore de scheduler/pg-boss). Rappel avant réservation programmé à la confirmation (`BOOKING_REMINDER_LEAD_MINUTES`, déjà présent en config depuis le Lot 0, jamais consommé jusqu'ici). Module `Automation` (CDC §36) : provisioning/révocation d'accès et notifications branchés dans les trois points de convergence existants (`CheckoutService.proceedAfterAuthorization`, `SplitCheckoutService.checkout`, `BookingsService.cancelBooking`), toujours après la transition d'état, jamais bloquants (`.catch()` + log). 14 tests dédiés (chiffrement/déchiffrement des codes, génération/import/révocation de grants, outbox : enqueue/dispatch/retry/échec), 132 au total. Vérifié manuellement : `GET /bookings/:id/access` (401 sans auth), `POST /admin/notifications/dispatch-due` (401 sans auth, 200 en admin), dégradation cohérente avec l'absence de compte Stripe (les parcours qui dépendent d'une confirmation de paiement pour déclencher l'accès/la notification ne sont testables qu'en intégration, pas en direct — même limite que depuis l'ADR-0010). ADR-0016 actée. Restant : test explicite des notifications parasites Doinsport (§77, nécessite une écriture réelle en Legacy avec `LEGACY_WRITE_ENABLED=true` en conditions pilote — non exécutable dans cette session), synchronisation Legacy→V2 pour l'import de codes d'une réservation créée directement côté Doinsport (aucune direction de sync construite à date), migration des templates existants (vérification, invitation SPLIT) vers l'outbox, monitoring "device offline" pour l'accès, vrai scheduler (pg-boss).

**Objectif.** Codes d'accès et notifications fiables.

**Tâches :**
- `access_grants`, génération de code `NNNN#` cryptographiquement aléatoire, anti-collision sur fenêtre temporelle
- Interface `AccessProvider` (provision/update/revoke/healthCheck), découplée du matériel
- Coexistence `V2_GENERATED` / `LEGACY_IMPORTED` pendant Dual Run
- Outbox de notifications (job durable), tous les templates §37.1
- Rappels avant réservation (délai configurable)
- Test explicite des notifications parasites Doinsport avant pilote (§77)

**Tests requis :** provision/revoke/retry access, non-perte de notification si provider e-mail temporairement indisponible.

**Points à valider (V-004 notifications Doinsport, V-005 accessCodes).**

**Gate de sortie :** E2E-019/E2E-020 (accès V2, accès Legacy) passent ; aucune notification dupliquée ou trompeuse constatée en test réel.

**Durée indicative : 2 semaines.**

---

## Lot 9 — Back-office

**Statut : API back-office faite et testée ; écrans (frontend) hors périmètre — aucun frontend n'existe dans ce projet à ce stade (voir ADR-0017).** Fait : `AuditLogService` (append-only, before/after expurgé des champs sensibles, CDC §58) — `audit_logs` existait depuis le Lot 0 mais n'était jamais écrit ; désormais alimenté par chaque mutation admin. CRM client (`CrmService`, CDC §40) : recherche, fiche complète (identité, statut V2/Legacy, réservations futures/passées, wallet et composition du solde, achats de packs, holds actifs, paiements, remboursements, notes administratives — `client_notes`, nouveau modèle), changement de rôle utilisateur (`SUPER_ADMIN` uniquement). Configuration tarifs/horaires/fermetures (`SchedulingAdminService`, CDC §10.1/§11.1) : CRUD complet sur `tariff_rules`/`opening_rules`/`court_closures`, chaque mutation auditée. Credit packs admin (`CreditPackAdminService`) : création/mise à jour/désactivation, distinct du parcours d'achat client (Lot 5). Dashboard planning (`BookingsAdminService.listForDashboard`, CDC §39.1) : données brutes multi-terrains sur une plage de dates (pas de timeline visuelle — c'est du frontend). Actions rapides admin (CDC §39.2) : annulation admin bypassant les garde-fous client (organisateur/délai — toujours auditée), remboursement (`RefundService` du Lot 4 enfin monté sur une route `POST /admin/payments/:id/refund`), "forcer resync" qui marque pour reprise sans rejouer aveuglément l'écriture Legacy (risque de doublon si l'état Legacy est déjà confirmé, CDC §16.2). Indicateurs de santé (`HealthIndicatorsService`, CDC §39.3) : 9 des 10 indicateurs calculés (dernier sync, erreurs sync, réservations `MANUAL_REVIEW`, paiements échoués, holds bloqués — seuil configurable `WALLET_HOLD_STALE_HOURS`, packs payés non crédités, kiosks/terminaux indisponibles, accès non provisionnés, notifications en échec) ; "frais provider anormaux" non calculé, faute de seuil défini par le CDC (documenté en lacune plutôt que d'inventer une règle métier). RBAC à trois niveaux : STAFF pour consulter, ADMIN pour modifier une configuration, SUPER_ADMIN pour changer un rôle. 29 tests dédiés, 161 au total. **Un gap pré-existant corrigé au passage** : `TerminalDevice` (Lot 7) n'était jamais nettoyé entre fichiers de test (`resetIntegrationTestData`), découvert en écrivant les tests d'indicateurs de santé (pollution inter-tests intermittente) — corrigé. Vérifié manuellement : RBAC (STAFF/ADMIN/SUPER_ADMIN) respecté sur chaque endpoint testé, CRUD tarifs fonctionnel avec audit, remboursement d'un paiement inconnu renvoie 404 proprement, tous les endpoints admin renvoient 401 sans authentification. ADR-0017 actée. Restant : les 25 écrans admin et le dashboard visuel (frontend, jamais démarré dans ce projet), exécution réelle de "forcer resync" (nécessite une infrastructure de job), "frais provider anormaux", endpoint de révocation de dispositif kiosque (gap Lot 7, non comblé ici), test explicite des notifications parasites Doinsport (§77, reporté depuis le Lot 8, nécessite un pilote réel).

**Objectif.** Donner à l'administration un contrôle complet de l'opération.

**Tâches :**
- Dashboard planning multi-terrains (4 terrains, timeline commune)
- CRM client complet (§40), historique client (§41)
- Configuration tarifs/horaires/fermetures, credit packs, frais SPLIT
- Wallets, holds, paiements, remboursements, coûts provider réels
- Indicateurs de santé sync/paiement/access (§39.3)
- Audit log append-only (§58) sur toutes les actions sensibles
- Écrans admin complets listés au CDC §55 (25 écrans)

**Tests requis :** RBAC par écran, actions destructrices avec confirmation + audit log obligatoire.

**Gate de sortie :** un administrateur peut piloter une journée complète (créer, modifier, annuler, rembourser, superviser la sync) sans jamais passer par Doinsport directement.

**Durée indicative : 3 semaines.**

---

## Lot 10 — Pilot hardening

**Objectif.** Rendre la plateforme prête pour un pilote réel avec de vrais utilisateurs et du vrai argent.

**Tâches :**
- Suite E2E Playwright complète (E2E-001 à E2E-025, §66)
- Tests de concurrence (§67) : double clic, deux paiements du même share, webhook pendant requête, job de régularisation lancé deux fois
- Tests de résilience/chaos (§68) : pannes Doinsport (401/422/500/timeout), Stripe timeout, webhook en retard, e-mail indisponible, worker redémarré
- Backup/restore testé réellement, RPO/RTO documentés
- Monitoring + alertes (§57.4) opérationnels
- Revue de sécurité (§59) et revue des points juridiques/comptables en attente (V-018 à V-024)
- Passage complet de la **checklist pré-pilote (Annexe B)**

**Gate de sortie :** Annexe B entièrement cochée, feature flag pilote activable pour une cohorte réduite.

**Durée indicative : 2–3 semaines.**

---

## Après le Lot 10 — Migration par cohortes et cutover

Suivre `docs/migration.md` : Phase 1 (interne) → Phase 2 (pilote) → Phase 3 (extension) → Phase 4 (généralisation) → Phase 5 (cutover) → Phase 6 (extinction), chacune gouvernée par les critères du CDC §51 et non par une simple impression de stabilité.

Le cutover final n'est déclenché qu'après passage complet de la **checklist Annexe C** (aucun paiement orphelin, aucun hold orphelin, frais SPLIT validés juridiquement, rollback testé, `LEGACY_WRITE_ENABLED=false` validé en conditions réelles, etc.).

---

## Vue d'ensemble

| Lot | Contenu | Durée indicative | Cumul |
|---|---|---|---|
| 0 | Dossier de projet | fait | — |
| 1 | Fondations | 2–3 sem. | 3 sem. |
| 2 | Legacy adapter | 2–3 sem. | 6 sem. |
| 3 | Booking core | 3 sem. | 9 sem. |
| 4 | Payments online/FULL | 3 sem. | 12 sem. |
| 5 | Wallet/crédits | 2–3 sem. | 15 sem. |
| 6 | SPLIT | 3 sem. | 18 sem. |
| 7 | Kiosque/Terminal | 2–3 sem. | 21 sem. |
| 8 | Access/Notifications | 2 sem. | 23 sem. |
| 9 | Back-office | 3 sem. | 26 sem. |
| 10 | Pilot hardening | 2–3 sem. | 29 sem. |

**Soit environ 6 à 7 mois jusqu'à un pilote réel prêt à démarrer**, pour une équipe de 1–2 développeurs, hors durée des phases de migration par cohortes elles-mêmes (qui dépendent du rythme d'adoption, pas du développement).

## Ce qui ne doit pas être développé maintenant (rappel §4)

Réseau social complet, messagerie instantanée, marketplace, moteur de recommandation, gamification/ELO, tournois complexes, computer vision, coaching IA, caisse/restaurant, apps natives Android/iOS, microservices, event streaming distribué, data warehouse, moteur de règles générique.

## Prochaines actions immédiates

1. Valider ce plan et l'affectation des ressources (combien de développeurs, sur quelle période).
2. Décider du framework backend précis (Node.js + quel framework structuré) et confirmer Next.js pour le frontend — trancher dans `docs/adr/0001-monolithe-modulaire.md`.
3. Démarrer le Lot 1 : initialiser le monorepo, `docker-compose`, migrations, module `identity`.
4. En parallèle, lancer les tests de caractérisation sur `padel-service/` (Lot 2) pendant que le Lot 1 avance — ces deux lots ne sont pas strictement séquentiels.
5. Ouvrir un accès Stripe test et confirmer les moyens de paiement locaux réellement disponibles pour le compte Ardenne Padel (prérequis Lot 4).
