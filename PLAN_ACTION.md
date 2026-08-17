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

**Statut : fait.** Fait : monorepo npm workspaces, `packages/{shared,config,domain}`, Prisma + PostgreSQL, module `identity` complet (register/login/logout/logout-all/verify-email/password reset), RBAC de base (`requireRole`), logs structurés, config typée avec validation au démarrage, 18 tests (unitaires + intégration réelle sur DB) verts, `tsc` strict sans erreur, parcours testé manuellement de bout en bout via l'API démarrée. Pipeline CI GitHub Actions (`.github/workflows/ci.yml`) en place et vert depuis la publication du repo sur `github.com/StarkGH/ardenne-padel-v2`. Restant : lint réellement exécuté en continu localement (config posée et exécutée en CI, pas encore intégrée à un hook pre-commit), module `users` distinct (profil au-delà de `/auth/me` — actuellement fusionné dans `identity`, à séparer si besoin).

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

**Statut : durcissement backend fait et testé ; volets frontend/infrastructure externe hors périmètre (aucun frontend n'existe dans ce projet, voir ADR-0018).** Fait : tests de concurrence CDC §67 (`concurrency.test.ts`, 5 tests — double clic FULL/SPLIT, double paiement de part, annulation concurrente, double livraison webhook, chacun avec de vraies requêtes simultanées `Promise.all`) et tests de résilience CDC §68 (`resilience.test.ts`, 4 tests — timeout Stripe à l'autorisation et à la capture, fournisseur de notification indisponible, provider d'accès indisponible). **Deux bugs de concurrence réels et un bug de résilience réel trouvés et corrigés en écrivant ces tests**, pas seulement testés : `checkout()` (FULL et SPLIT) et `cancelBooking()` ne réclamaient pas atomiquement la réservation avant d'agir (double hold wallet / double annulation Legacy possibles), `payShare()` avait la même faille pour le paiement d'une part (corrigé en activant `BookingShareStatus.PAYMENT_PENDING`, présent dans le schéma depuis le Lot 6 mais jamais utilisé) ; une capture Stripe qui lève une exception (timeout) après confirmation Legacy n'était pas distinguée d'une capture qui échoue proprement, risquant un retour silencieux à un état reclaimable alors que Legacy a déjà une réservation réelle — corrigé pour produire `MANUAL_REVIEW` dans les deux cas. Durcissement sécurité (CDC §59.2) : `helmet`, `cors` (liste blanche `CORS_ALLOWED_ORIGINS`), `express-rate-limit` (global + limite dédiée `/auth/*`) — trois manques réels comblés ; revue complète de la checklist §59 dans `docs/security.md` (16/20 pleinement satisfaites). Backup/restore (CDC §61) : test réel `pg_dump`/`pg_restore` exécuté contre la base de développement, documenté dans `docs/backup-restore.md` avec RPO/RTO proposés (à valider avec le club). Feature flag pilote (Annexe B) : `User.pilotUser` + `PILOT_MODE_ENABLED`, cohorte activable via `PATCH /admin/clients/:userId/pilot-cohort` (audité), garde-fou dans `BookingsService.createBooking` donc identique pour le parcours web et le QR handoff kiosque. Indicateurs d'alerte CDC §57.4 (`AlertsService`/`GET /admin/alerts`, 6 tests) : incohérences détectables entre tables (paiement capturé sans booking confirmé, réservation confirmée sans paiement, hold non libéré après annulation, etc.) — sans intégration de paging réelle (aucun fournisseur choisi). Mapping des 25 scénarios E2E du CDC §66 vers la couverture de test existante dans `docs/testing.md` (17 pleinement couverts, 6 partiels, 2 non couverts) plutôt qu'une suite Playwright fabriquée sans frontend à piloter — un gap trouvé en construisant ce mapping (annulation hors délai jamais testée) comblé dans la foulée. 16 nouveaux tests dédiés, 177 au total. ADR-0018 actée. Restant : sauvegardes automatiques récurrentes (pas encore de cron), monitoring/alertes avec un vrai fournisseur de paging, V-018 à V-024 (comptabilité/TVA crédits, validation juridique du frais SPLIT — points métier/juridiques externes au code, CDC §100 : "ne doivent pas bloquer le développement"), synchronisation Legacy→V2 (modèle de données posé au Lot 11/ADR-0031, job d'import/scheduler toujours à construire), Terminal en parcours de réservation réel (nécessite un compte Stripe et un lecteur physique), révocation de dispositif kiosque non exposée par une route (gap Lot 7/9), 25 écrans admin et dashboard visuel (frontend, jamais démarré).

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

## Lot 11 — Modèle de données import Doinsport

**Statut : modèle de données fait et testé ; le job de synchro lui-même reste à construire.** `LegacyDoinsportAdapter` sait interroger Doinsport (`listClients`/`listBookings`) depuis le Lot 2, mais rien n'appelait ces méthodes pour peupler V2 — aucun script d'import, aucun scheduler (`LEGACY_SYNC_INTERVAL_SECONDS` en config depuis le Lot 0, jamais lu). Ce lot pose la structure de données pour deux besoins normatifs jamais construits : la migration d'identité (CDC §7.3-§7.5) et l'anti-collision Dual Run (CDC §10.3 — *"les réservations Doinsport sont intégrées comme occupations externes"*, non implémenté à ce jour). `LegacyClient` étendu plutôt qu'un `ShadowClient` séparé (il joue déjà ce rôle depuis le Lot 2, commentaire de schéma à l'appui) : `migrationStatus` (machine à états CDC §7.4, explicite plutôt que déduite de `linkedUserId`), `mergeNote` pour la déduplication (CDC §7.5), `linkedUserId` promu en vraie relation unique (empêche qu'un compte V2 se lie à deux clients Doinsport différents — bug possible avant ce changement). Nouveau modèle `ClientMigrationInvitation` (même pattern de jeton opaque haché que les autres tokens identity, mais rattaché au `LegacyClient` puisque le `User` n'existe pas encore à l'émission). Nouveau modèle `LegacyBooking` — une ligne par terrain occupé (une réservation Doinsport peut couvrir plusieurs terrains), `@@unique([externalId, courtId])` servant de cible d'upsert idempotent, indexé `(courtId, startAt, endAt)` pour brancher directement dans `AvailabilityRepository.findOccupyingBookings`. `legacyClientId` volontairement nullable dessus : le mapping DTO actuel n'expose pas le propriétaire d'une réservation Doinsport, dépendance documentée plutôt qu'hypothèse silencieuse. Nouveau modèle `LegacySyncRun` pour tracer les exécutions du futur job (table dédiée, pas le journal d'audit générique — pensé pour la revue humaine, pas pour un volume de job récurrent). 8 nouveaux tests validant les invariants (état par défaut, parcours complet jusqu'à `MIGRATED`, unicité de liaison, cascade de suppression, requête d'occupation par terrain/plage, exclusion des réservations annulées, upsert idempotent, cycle de vie d'un run). 226 tests au total, 37 fichiers verts. ADR-0031 actée.

**Mise à jour — script d'import construit (voir ADR-0032).** `npm run import:legacy --workspace apps/api -- --target=clients|bookings|all` : pour les clients, appelle `listClients()` (qui upserte déjà chaque fiche depuis le Lot 2) puis lance la passe de déduplication CDC §7.5 sur les `LEGACY_ONLY`. Pour les réservations, `listBookings(range)` + `getBooking()` par item, résolution du terrain via le mapping existant, upsert dans `LegacyBooking`. **Un bug réel trouvé et corrigé en testant contre l'API réelle** : la pagination de `listClients()`/`listBookings()` se fiait à `totalItems`, absent quand `/clubs/clients` renvoie un tableau brut — l'import s'arrêtait silencieusement après la première page de 200, perdant 82 % des clients réels (1090 au total après correction). Pagination corrigée pour s'arrêter sur une page incomplète, jamais sur un total. `LegacyBookingDto` étendu avec `bookingOwnerClientId`, résolu depuis `raw.participants[].client.id` (le participant `bookingOwner: true`) — vérifié sur un vrai payload, distinct de `participants[].user.id` (le staff qui a créé la réservation). Vérifié en conditions réelles (lecture seule côté Doinsport) : 1090 clients importés, 49 réservations sur une fenêtre de test, 31/49 propriétaires résolus (les 18 restantes n'ont simplement aucun `bookingOwner` côté Doinsport). Données réelles nettoyées de la base de dev après vérification. 6 nouveaux tests (logique de dédup pure). 232 tests au total, 38 fichiers verts.

**Mise à jour — anti-collision Dual Run branchée (voir ADR-0033).** `AvailabilityRepository.findOccupyingBookings` fusionne désormais les occupations `Booking` V2 et `LegacyBooking` (canceled exclues), même forme `{startAt, endAt}` consommée telle quelle par `computeAvailableSlots` — CDC §10.3 ("les réservations Doinsport sont intégrées comme occupations externes") enfin implémenté, un commentaire l'anticipait depuis le Lot 3. Chevauchement V2/Legacy accepté sans déduplication (une réservation V2 synchronisée vers Doinsport peut être réimportée, doublon fonctionnellement neutre — un test dédié le couvre explicitement). Vérifié par 5 nouveaux tests d'intégration et en conditions réelles contre le serveur de dev (créneau occupé confirmé absent de `GET /availability`, y compris vérification de la conversion de fuseau horaire Europe/Brussels). 237 tests au total, 39 fichiers verts.

**Mise à jour — écran admin de revue MERGE_REQUIRED construit (voir ADR-0034).** `/admin/legacy-clients` (`LegacyMigrationAdminService`) : liste filtrable par statut de migration (`MERGE_REQUIRED` par défaut), trois actions par fiche — lier manuellement à un compte V2 (recherche client réutilisée, `GET /admin/clients?q=`, revalidation de l'unicité du lien), rejeter (`DISABLED`, motif conservé), remettre en attente (`LEGACY_ONLY`, relance la déduplication automatique au prochain import). Lier/rejeter interdits depuis un statut déjà résolu sans `reset` explicite d'abord — évite qu'un second clic écrase silencieusement un lien déjà posé. Vérifié en direct de bout en bout : client en conflit inséré, recherché, lié à un compte V2, disparaît de l'onglet conflit, réapparaît sous "Migré" avec le lien affiché, action tracée dans l'audit log (`LEGACY_CLIENT_LINKED`). 7 nouveaux tests backend (244 au total, 40 fichiers verts). Build et lint propres. Restant : scheduler récurrent (toujours pas de pg-boss, le script d'import reste à lancer manuellement — donc `LegacyBooking`/`LegacyClient` ne sont jamais à jour à la seconde près), tableau de bord `LegacySyncRun` (table existe, rien ne l'affiche), flux de rédemption du lien d'invitation (`ClientMigrationInvitation` existe côté modèle, aucune route ne le consomme).

---

## Frontend Lot 1 — Fondations Next.js et parcours FULL online

**Statut : fait et vérifié en direct dans un vrai navigateur.** Aucun frontend n'existait dans ce projet avant ce lot (10 lots backend). Fait : `apps/web` scaffoldé (Next.js App Router, TypeScript, Tailwind, port 3001 cohérent avec `PUBLIC_BASE_URL`/`WEB_PORT` déjà présents depuis le Lot 0), PWA installable (manifest + icône SVG), état d'authentification client (`SessionProvider`, `GET /auth/me`). Parcours construits : accueil (écran 1), inscription/connexion/vérification e-mail (écran 5), réservation FULL complète — choix simple/double (écran 2), terrain, calendrier (écran 3), créneau + durée (écran 4), récapitulatif avec prix réel (écran 7), paiement (écrans 8-10, dégradation propre si Stripe non configuré), confirmation + code d'accès (écran 11), mes réservations (écran 12), détail + annulation (écrans 13-14). Reprise de sélection après authentification via `sessionStorage` (CDC §53). **Un vrai bug trouvé et corrigé pendant la vérification en direct** : l'effet de rechargement des disponibilités effaçait inconditionnellement le créneau restauré depuis `sessionStorage` juste après l'avoir restauré (course entre l'effet de restauration et l'effet de disponibilité) — corrigé pour ne réinitialiser le créneau que s'il n'est plus valide pour la nouvelle liste. Vérifié de bout en bout dans un navigateur réel (via l'arbre d'accessibilité, l'outil de capture d'écran n'étant pas disponible dans cet environnement) : accueil → sélection terrain/créneau → redirection connexion avec reprise exacte de la sélection → connexion avec le compte seedé `joueur1@dev.ardenne-padel.local` → création de réservation réelle contre l'API → page de paiement avec récapitulatif exact → tentative de paiement → message de dégradation `STRIPE_NOT_CONFIGURED` affiché proprement (même limite que tout le reste du projet, ADR-0010) → réservation visible dans "mes réservations" avec le bon statut → détail accessible. ADR-0019 actée. Build et lint propres. Restant : 18 des 23 écrans client MVP (SPLIT, wallet/crédits, profil, gestion des moyens de paiement, paiement par invitation, écrans de garantie/consentement split), 8 écrans kiosque, 25 écrans admin — aucun n'a d'API manquante côté backend (Lots 1-10 déjà complets), seuls les écrans restent à construire. Rendu serveur de l'état authentifié non fait (état client uniquement). Icônes PWA en SVG, pas de PNG multi-résolutions. Aucune intégration Stripe Elements réelle (attend un compte Stripe).

---

## Frontend Lot 2 — Parcours SPLIT (paiement partagé)

**Statut : fait et vérifié en direct dans un vrai navigateur, jusqu'à la limite imposée par l'absence de compte Stripe.** Fait : 2 endpoints backend ajoutés, strictement nécessaires pour éviter de dupliquer la logique métier côté frontend (CDC §129) — `GET /bookings/:id/split-preview` (aperçu des parts/frais sans effet de bord, `SplitCheckoutService.previewShares`, réutilise `computeSplitShares`) et `GET /bookings/:id/shares` (statut des parts pour l'organisateur, `BookingShareService.listSharesForOrganizer`), tous deux réservés à l'organisateur (403 sinon, testé). Côté `/book` : mode de paiement FULL/SPLIT (écran 8) et gestion des participants — nom + e-mail, jusqu'à `capacité du terrain - 1` (écran 6) ; le brouillon de session persiste désormais aussi le mode et les participants, pas seulement terrain/créneau/durée. `/checkout/[bookingId]` bifurque désormais selon `paymentMode` : pour SPLIT, répartition en temps réel depuis l'aperçu (écran 23), choix de garantie wallet/carte (écran 21), consentement explicite obligatoire si carte (écran 22). Détail de réservation étendu avec le statut de chaque part pour les réservations SPLIT (écran 13). Nouvelle page `/pay/[token]` (écran 20, paiement via invitation) avec choix wallet/carte. Vérifié en direct : SPLIT créé avec un participant, reprise de sélection après connexion incluant le participant (draft `sessionStorage`), page de paiement partagé avec répartition exacte (48€ → 24€/24€) calculée par l'API réelle, écran de consentement carte qui apparaît/disparaît correctement, dégradation `STRIPE_NOT_CONFIGURED` propre à la tentative de paiement, `/pay/[token]` avec jeton inconnu affiche une erreur propre. 4 nouveaux tests backend (aperçu sans effet de bord, rejet non-organisateur ×2, listing des parts), 180 au total. ADR-0020 actée. Build et lint propres. Restant : paiement d'une part par un participant invité non vérifiable en direct (nécessite qu'une invitation existe réellement, donc un compte Stripe — couvert uniquement par les tests backend), pas d'écran de gestion des participants après création de la réservation, aucune intégration Stripe Elements/SetupIntent réelle, wallet/profil/kiosque et les 25 écrans admin toujours à construire.

---

## Frontend Lot 3 — Wallet / crédits prépayés

**Statut : fait et vérifié en direct dans un vrai navigateur, y compris un paiement réellement abouti.** Aucun ajout backend n'a été nécessaire : `GET /me/wallet`, `GET /me/wallet/transactions`, `GET /credit-packs` et `POST /credit-packs/:id/purchase` couvraient déjà les trois écrans. Fait : `/wallet` (écran 15, solde disponible + composition payé/bonus/offert), `/wallet/packs` (écran 16, liste des packs actifs triés par `displayOrder`, achat avec dégradation `STRIPE_NOT_CONFIGURED` identique au reste du parcours de paiement), `/wallet/history` (écran 17, historique avec libellés français par type de transaction, écritures d'audit sur les holds affichées distinctement du fait qu'elles ne changent jamais le solde réel). `/checkout/[bookingId]` (FULL) étendu pour le paiement mixte wallet + externe prévu par le CDC (Annexe B) : case à cocher "Utiliser mon solde wallet" appliquant `Math.min(availableCents, priceTotalCents)`, carte "Moyen de paiement" masquée si le wallet couvre déjà la totalité, `applyWalletCents` transmis à `POST /payments/checkout` sans dupliquer la règle d'application côté client (CDC §129). Le solde de `joueur1@dev.ardenne-padel.local` a été crédité manuellement en base (100,00 € `PAID`) pour permettre une vérification réelle en l'absence de tout compte Stripe. Vérifié en direct : solde et composition corrects, historique correct, création d'une réservation FULL à 24,00 €, case wallet cochée, **paiement 100 % wallet réellement abouti** (réservation `CONFIRMED` sans passer par `paymentProvider.createPayment`, `remainingCents === 0`) — première vérification en conditions réelles de navigateur d'un paiement qui aboutit plutôt que de se dégrader proprement, depuis le début du projet — puis solde (76,00 €) et historique (`HOLD_CREATED` → `HOLD_CAPTURED` → `DEBIT_BOOKING -24,00 €`) confirmés corrects après coup. ADR-0021 actée. Suite de tests backend (180 tests) et build propres après reseed ; les 128 problèmes de lint restants sont préexistants (fichiers générés `.next` et `prisma/seed.ts`, confirmé par `git stash`), indépendants de ce lot. Restant : achat réel d'un pack de crédits non vérifiable en direct (dégradation `STRIPE_NOT_CONFIGURED`, comme FULL/SPLIT), pas de filtre sur l'historique, profil/kiosque et les 25 écrans admin toujours à construire.

---

## Frontend Lot 4 — Profil et gestion des moyens de paiement

**Statut : fait et vérifié en direct dans un vrai navigateur.** Contrairement aux trois lots frontend précédents, aucun des deux endpoints requis n'existait côté backend. Ajoutés : `GET/PATCH /me/profile` (`apps/api/src/modules/identity/profile.routes.ts`, montés sous `/me/*` comme wallet/bookings/payment-methods plutôt que sous `/auth/*`, réservé aux actions d'authentification) — `req.authUser` reste volontairement minimal (`id/email/role/status/pilotUser`, attaché sur chaque requête authentifiée) plutôt qu'élargi avec les champs de profil, pour ne pas alourdir une requête exécutée en permanence pour un besoin propre à un seul écran. `POST /auth/password/change` (mot de passe actuel + nouveau), distinct du flux `password/reset` par jeton e-mail : contrairement au reset, ne révoque pas les sessions actives (l'utilisateur vient de prouver qu'il connaît le mot de passe actuel depuis une session déjà authentifiée). `GET /me/payment-methods` et `DELETE /me/payment-methods/:id`, ajoutés à l'interface `PaymentProvider` (`listPaymentMethods`/`detachPaymentMethod`) plutôt qu'en accès direct au SDK Stripe dans les routes — aucun modèle local de cartes (CDC §2.6, Stripe reste seule source de vérité), liste vide sans appel Stripe si l'utilisateur n'a pas encore de `stripeCustomerId`, et vérification d'appartenance avant `detach()` puisque l'API Stripe ne scope pas cet appel par customer (CDC §111, testé avec un scénario utilisateur A/utilisateur B). Côté frontend : `/profile` (écran 18, lecture + édition prénom/nom/téléphone, changement de mot de passe, déconnexion de toutes les sessions) et `/profile/payment-methods` (écran 19, liste/suppression de cartes, ajout via le `POST /payments/setup` déjà existant avec la même dégradation `STRIPE_NOT_CONFIGURED` que le reste du parcours de paiement). Vérifié en direct : profil lu et modifié avec persistance confirmée après rechargement complet de la page, mot de passe actuel incorrect refusé proprement, changement de mot de passe réussi avec session courante préservée (contrairement au reset par jeton) et ancien mot de passe immédiatement refusé au login, déconnexion de toutes les sessions fonctionnelle, écran 19 vérifié pour son état vide et sa dégradation Stripe. ADR-0022 actée. 11 nouveaux tests backend (191 au total), build et lint propres. Restant : liste/suppression de cartes non vérifiable en direct avec de vraies données (nécessite un compte Stripe), pas de marquage carte par défaut, changement d'e-mail non traité (nécessiterait son propre flux de re-vérification), kiosque et les 25 écrans admin toujours à construire.

---

## Frontend Lot 5 — Kiosque / QR handoff

**Statut : fait et vérifié en direct dans un vrai navigateur (deux onglets simulant tablette + téléphone).** Construit les écrans 1-7 du CDC §54.1 sans ajout backend pour le chemin QR : `POST /kiosk/checkout-sessions`, `GET /kiosk/checkout-sessions/:token` (réclamation automatique dès qu'un utilisateur authentifié consulte une session PENDING, pas d'endpoint `/claim` séparé — ADR-0014), `GET .../:id/status`, `POST .../:id/cancel` sont utilisés tels quels. Fait côté frontend : `/kiosk` (écrans 1-2, sélection terrain/date/créneau/durée FULL uniquement puis branchement), `/kiosk/qr` (écrans 4-7, génère un QR client-side — librairie `qrcode`, CDC §22.2 : le QR ne porte qu'une référence de session opaque — puis interroge le statut toutes les 3s jusqu'à confirmation), `/kiosk-pay/[token]` (reprise côté téléphone, même schéma que `/pay/[token]`), `/kiosk/pay` (écran 3 "Payer ici" : identification directe sur la tablette puis réutilisation intégrale du checkout FULL existant, déjà vérifié avec un paiement 100 % wallet abouti, plutôt qu'une collecte carte-présente réelle qui ne peut structurellement pas aboutir dans cet environnement — pas de lecteur physique, pas de capture HTTP exposée côté backend, ADR-0014 §4 différé jusqu'à V-014). Client `kiosk-api.ts` séparé du client cookie habituel (authentification par dispositif, `Authorization: Bearer`, jamais de cookie). Dispositif kiosque de dev provisionné de façon idempotente dans `prisma/seed.ts` (comme les comptes utilisateurs), pas un script ponctuel. Vérifié en direct : sélection complète avec prix réel, QR généré et scanné (simulé), connexion sur "téléphone", réclamation automatique et création de réservation réelle, redirection dans le checkout FULL, **paiement 100 % wallet réellement abouti**, mise à jour temps réel de l'écran tablette jusqu'à confirmation sans rechargement, annulation depuis la tablette (session `CANCELED` confirmée en base), chemin "Payer ici" (identification + checkout existant). **Deux bugs réels trouvés et corrigés pendant la vérification** : double création de session sous StrictMode (POST non idempotent rejoué par le double-appel d'effet de React en dev — corrigé par une garde `useRef`) et statut jamais rafraîchi côté tablette (réponses `GET` de polling mises en cache par le navigateur — corrigé avec `cache: "no-store"`). ADR-0023 actée. Build et lint propres. Deux tests backend préexistants (`bookings.http.integration.test.ts`, `concurrency.test.ts`) échouent de façon reproductible sur `main` non modifié (vérifié via `git stash`), probablement sensibles à l'heure/la date d'exécution — sans lien avec ce lot, signalés séparément. Restant : écran 3 ne collecte pas réellement via un lecteur Stripe Terminal physique (V-014, ADR-0014, inchangé) ; pas de déconnexion automatique après paiement sur la tablette (hygiène partagée à la charge du client/staff) ; écran 8 (achat/recharge crédits au bar) non construit comme écran kiosque dédié, accessible via `/wallet/packs` après identification ; les 25 écrans admin restent à construire.

---

## Frontend Lot 6 — Écrans admin, première tranche (opérations)

**Statut : fait et vérifié en direct dans un vrai navigateur (7 des 25 écrans du CDC §55).** Le Lot 9 backend avait délibérément construit l'API back-office sans aucun frontend (ADR-0017, "éviter deux surfaces à moitié finies"). Ce lot construit la tranche opérationnelle quotidienne : Login admin, Dashboard, Planning multi-terrains, Détail réservation, Création réservation, Clients, Fiche client — `apps/web/src/app/admin/*`, gating de rôle (`STAFF/ADMIN/SUPER_ADMIN`) porté uniquement côté frontend puisque le backend n'a qu'une seule authentification (même cookie de session que le client, seul `role` change). Deux ajouts backend minimaux, chacun comblant un trou réel : `GET /admin/bookings/:id` (aucune route n'existait pour consulter la réservation d'un tiers en admin — `GET /bookings/:id` client refuse tout non-organisateur) et `POST /admin/bookings` (écran 5 : aucun moyen de créer une réservation *pour* un client choisi n'existait ; réutilise `BookingsService.createBooking` avec `source: "ADMIN"`, valeur déjà présente dans l'enum Prisma mais jamais écrite avant ce lot). Un bug trouvé et corrigé pendant l'écriture (avant même la vérification en direct) : la fiche client ne pouvait pas afficher l'état de la cohorte pilote (`CrmRepository.findUserProfile` ne sélectionnait pas `pilotUser`) — corrigé plutôt que de livrer un bouton de bascule dont l'état affiché ne reflète jamais la réalité. Vérifié en direct avec un compte admin réel : refus propre d'un compte CUSTOMER, dashboard avec indicateurs et une alerte authentique ("kiosque hors ligne", provenant du dispositif seedé au Lot 5), planning affichant une réservation fraîchement créée groupée par terrain, création de réservation complète (recherche client → créneau → prix réel → `source: ADMIN` confirmé), détail réservation avec identité organisateur, fiche client complète (profil, historique, note ajoutée et relue, bascule cohorte pilote fonctionnelle), gating de rôle confirmé (aucun bouton de changement de rôle pour un compte ADMIN non SUPER_ADMIN). 4 nouveaux tests backend, 195 au total (33/33 fichiers verts). Build et lint propres. ADR-0024 actée. Restant : 18 écrans admin (tarifs, horaires/fermetures, wallets, crédit/débit avec motif, packs, achats, holds, paiements/remboursements, coûts provider, configuration split, kiosks, terminaux, sync Doinsport, accès, incidents/révision manuelle, audit log, paramètres) ; planning limité à une vue journalière par terrain sans détection de chevauchement ; pas de pagination sur `GET /admin/bookings` (hérité du Lot 9) ; recherche client sans debounce.

---

## Frontend Lot 7 — Écrans admin, deuxième tranche (les 18 restants)

**Statut : fait et les 25 écrans admin du CDC §55 sont désormais tous construits.** Neuf ajouts backend minimaux, chacun justifié par un écran précis : `WalletAdminService` (nouveau) monte enfin sur des routes `WalletService.creditAdmin`/`releaseHold`/`captureHold`, qui existaient déjà mais n'étaient reliés à aucune route (dette documentée par ADR-0017) — plus une méthode réellement nouvelle, `debitAdmin` (aucun débit manuel hors réservation n'existait). `GET /admin/audit-log` (nouveau) expose enfin `AuditLogRepository.listRecent`, jusqu'ici jamais routé. `GET /admin/settings` (SUPER_ADMIN, nouveau) donne un instantané en lecture seule de la configuration — la config reste 100 % env-var/redéploiement, aucun système d'édition persistée n'a été construit (disproportionné pour ce lot, voir ADR-0025) ; couvre à la fois les écrans 17, 18 et 25 (même objet de configuration plat). `POST /admin/kiosk-devices/:id/revoke` monte `KioskDeviceService.revoke`, jusqu'ici non routé. `terminal-admin.routes.ts` (nouveau) ajoute l'enregistrement/liste/révocation de `TerminalDevice`, qui n'avait aucune route admin. `GET /admin/credit-pack-purchases` et `GET /admin/payments` (nouvelles méthodes de repository) donnent les premières vues globales de ces données, jusqu'ici visibles uniquement une par une via la fiche client. `GET /admin/access-grants` utilise une **projection Prisma dédiée**, jamais fusionnée avec `findById`/`listInRange` (utilisées aussi côté client) — un premier réflexe d'ajouter `accessGrants` à ces méthodes partagées a été abandonné avant commit car cela aurait fait transiter `codeCiphertext`/`codeIv`, même chiffrés, jusqu'à une réponse HTTP client (CDC §57.1). Écrans Wallets/Crédit-débit/Holds regroupés en un seul écran de gestion par client (le wallet n'existe qu'au singulier, pas de liste globale côté API) ; Synchronisation Doinsport et Incidents/Manual Review réutilisent le planning admin existant filtré côté client (ni l'un ni l'autre n'est un concept de données distinct). Vérifié en direct avec un compte SUPER_ADMIN pour 15 des 18 écrans (tarifs créés/désactivés, horaires/fermetures créées/supprimées, wallet crédité/débité/garanti/libéré sur un compte réel, packs de crédits, remboursement avec dégradation `STRIPE_NOT_CONFIGURED` cohérente, kiosque et terminal enregistrés/révoqués, journal d'audit filtrable montrant une trace réelle de toutes ces actions, paramètres affichant la config réellement active du serveur) ; 3 en état vide confirmé (couverts pour le cas non-vide par un test route-level dédié : achats de crédits, accès — y compris la non-fuite du chiffré —, synchronisation). Un bug trouvé et corrigé pendant l'écriture des tests : un fichier de test créait un court sans le nettoyer en `afterAll`, polluant la base de dev partagée (visible en direct dans l'écran Tarifs) — corrigé, ligne polluée supprimée manuellement. ADR-0025 actée. 11 nouveaux tests backend (206 au total, 35 fichiers verts). Build et lint propres. Note indépendante *(corrigée le 2026-08-17, voir ADR-0025 addendum)* : la classe de tests intermittente identifiée pendant ce lot (`split-checkout.service.test.ts` et, selon le run, `checkout.service.test.ts`/`bookings.http.integration.test.ts`) n'était pas une interaction d'isolation entre fichiers — c'était une deuxième ligne de tarif polluante du même genre que celle déjà trouvée et corrigée juste au-dessus (créée en direct via l'écran Tarifs, `courtId`/`courtType` tous deux `null`, jamais supprimée après vérification manuelle), qui s'appliquait par coïncidence à tous les terrains de test avec la même priorité que les tarifs propres à chaque fichier, départagée de façon quasi aléatoire par tri d'UUID. Supprimée manuellement ; 10 exécutions consécutives de la suite complète toutes vertes après coup. Aucun changement de code nécessaire. Restant : Paramètres reste en lecture seule (pas d'édition depuis l'admin) ; Terminaux Stripe est un inventaire administratif, pas un appairage matériel réel (point différé d'ADR-0014, V-014, inchangé) ; Synchronisation Doinsport et Incidents bornés à une fenêtre de dates fixe.

---

## Frontend Lot 8 — Écrans client/kiosque secondaires

**Statut : fait et vérifié en direct dans un vrai navigateur.** Complète les deux derniers gaps "écran manquant" listés en Restant des Lots 1-5 (aucune API manquante côté backend pour l'un ou l'autre) : gestion des participants après création de la réservation (ADR-0020 §3) et écran de recharge kiosque dédié (écran 8, CDC §54.1, ADR-0023). `SplitCheckout` (`/checkout/[bookingId]`) porte désormais sa propre section "Participants" — ajout/retrait via `POST/DELETE /bookings/:id/participants` (existants depuis le Lot 3, jamais appelés après `/book`), avec rechargement de la réservation *et* de l'aperçu de répartition à chaque changement, puisque le prix par part en dépend directement ; choix délibéré de ne pas construire un écran séparé, la fenêtre de modification (`DRAFT`/`CHECKOUT_PENDING`) coïncidant exactement avec l'écran de checkout. `/kiosk/credits` (nouveau) et `/wallet/packs` partagent désormais le même composant `CreditPacksPurchase` (`apps/web/src/components/credit-packs-purchase.tsx`), paramétré par titre/destinations plutôt que dupliqué — un lien "Acheter ou recharger des crédits" a été ajouté à l'accueil kiosque, au même niveau que la sélection de réservation (l'écran 8 n'est pas rattaché à une réservation). Vérifié en direct : réservation SPLIT créée avec 1 participant, un deuxième ajouté depuis le checkout (répartition recalculée en direct de 24,00 €/24,00 € à 16,00 €/16,00 €/16,00 € pour 3 personnes), puis retiré (répartition revenue à 24,00 €/24,00 €) ; écran kiosque credits atteint depuis l'accueil, packs réels affichés, achat dégradé proprement (`STRIPE_NOT_CONFIGURED`) ; `/wallet/packs` revérifié fonctionnel après le refactor. ADR-0026 actée. Aucun ajout backend, build/lint/tests inchangés (206 tests verts). Restant : changement d'e-mail toujours non traité (capacité backend manquante, pas un écran — hors périmètre de ce lot) ; pas de message explicite quand la capacité du terrain limite l'ajout de participants (le bouton disparaît sans explication) ; pas de déduplication d'e-mail entre participants.

---

## Frontend Lot 9 — Changement d'adresse e-mail

**Statut : fait et vérifié en direct dans un vrai navigateur.** Traite le dernier gap laissé de côté par ADR-0026 : contrairement aux deux gaps du Lot 8, celui-ci exigeait une vraie capacité backend (jeton de re-vérification pointant vers une nouvelle adresse), pas seulement un écran. Nouveau modèle `EmailChangeToken` (distinct d'`EmailVerificationToken`, qui n'a pas de notion d'adresse cible différente de `user.email`), même pattern de jeton opaque haché que le reste du module identity. `POST /me/profile/email-change` (sous `/me/*`, session + mot de passe actuel requis — même garde-fou que `changePassword`, ADR-0022) émet le jeton et envoie le lien de confirmation **uniquement à la nouvelle adresse**, jamais à l'ancienne. `POST /auth/email-change/confirm` (sous `/auth/*`, public — même modèle de sécurité que `/verify-email`/`/password/reset` : le jeton est la preuve, pas la session) applique le changement après avoir revérifié l'unicité de l'adresse au moment de la confirmation (quelqu'un a pu la prendre entre-temps). Comme `changePassword`, la session courante n'est pas révoquée. Côté frontend : nouvelle section "Adresse e-mail" sur `/profile` (nouvelle adresse + mot de passe actuel, confirmation "un e-mail de confirmation a été envoyé à la nouvelle adresse") et nouvel écran `/profile/email-change` (lit `?token=`, appelle la confirmation, affiche succès ou erreur), suivant exactement le patron déjà en place sur `/verify-email`. Vérifié en direct : demande depuis `/profile` avec mot de passe ressaisi, lien de confirmation récupéré (log console du serveur de dev), clic sur le lien, `GET /auth/me` reflète la nouvelle adresse sans re-connexion (session préservée), connexion avec l'ancienne adresse refusée (401), connexion avec la nouvelle acceptée (200). ADR-0027 actée. 4 nouveaux tests backend (210 au total, 35 fichiers verts). Build et lint propres côté web et api. Restant : l'ancienne adresse n'est jamais notifiée qu'un changement a eu lieu ; pas de nettoyage des jetons expirés non utilisés (même dette déjà assumée pour les autres types de jetons).

---

## Frontend Lot 10 — Chiffre d'affaires réservations (V-018)

**Statut : fait et vérifié en direct dans un vrai navigateur.** Comble le gap identifié dans `docs/tva.md` §3.3 : le comptable (BDO) reconstituait jusqu'ici le CA "Padel" manuellement pour son template de déclaration TVA. Nouvel écran admin `/admin/reports` (`GET /admin/reports/bookings-revenue?from=&to=`, `ReportsService`) : somme `Booking.priceTotalCents` des réservations `CONFIRMED`/`COMPLETED` groupées par jour sur `confirmedAt` — le seul instant valable pour toutes les voies de paiement (Stripe, wallet, mixte), puisqu'une réservation payée 100 % wallet ne crée pas de ligne `Payment` (baser le rapport sur `Payment` aurait sous-compté ces réservations). Ventilation TVAC/HTVA/TVA au taux `BOOKING_VAT_RATE_PERCENT` (nouvelle variable de config, défaut 6 %, cohérent avec le taux confirmé dans `docs/tva.md` — configurable plutôt que codé en dur, puisqu'un taux de TVA peut changer). Export CSV client-side pour coller directement les lignes journalières dans le template comptable existant. Vérifié en direct : réservation créée et payée 100 % wallet comme donnée de test, écran atteint depuis le nouveau lien de menu "Chiffre d'affaires", totaux et ventilation corrects (24,00 € TVAC → 22,64 € HTVA + 1,36 € TVA), export CSV déclenché sans erreur. 3 nouveaux tests backend (213 au total, 36 fichiers verts). Build et lint propres. Restant : remboursements non déduits (limitation documentée, pas une omission silencieuse — une réservation remboursée reste comptée au mois de sa confirmation) ; pas de export PDF/Excel natif (CSV seulement) ; ne couvre que la location de terrain, cohérent avec le périmètre actuel de l'application (voir `docs/tva.md` §2).

---

## Frontend Lot 11 — Lien "Nouvelle réservation" et sélection de joueurs (admin)

**Statut : fait et vérifié en direct dans un vrai navigateur.** Corrige deux lacunes trouvées en vérifiant l'accès à l'écran admin "Nouvelle réservation" (construit au Lot 6, jamais lié depuis l'interface) : (1) aucun lien nulle part n'y menait (ni menu, ni planning) — ajouté à `NAV_LINKS` et en bouton sur `/admin/planning` ; (2) l'écran ne permettait de choisir qu'un seul client, aucune façon d'ajouter d'autres joueurs. Nouvelles routes `POST/DELETE /admin/bookings/:id/participants[/:participantId]` (`BookingsAdminService.adminAddParticipant`/`adminRemoveParticipant`, réutilisant `BookingsRepository` directement comme `adminCancel`/`forceResync`, sans le contrôle "organisateur uniquement" des routes client équivalentes, toujours audité en contrepartie). Écran "Réservation créée" devient un vrai écran de gestion des joueurs (liste + ajout + retrait), même patron d'UI que `/checkout/[bookingId]` côté client. Vérifié en direct : lien de menu et bouton planning fonctionnels, réservation créée (Terrain Double, 48,00 €), joueur ajouté puis retiré, les deux actions tracées dans le journal d'audit. **Un bug trouvé et corrigé pendant la vérification** : le champ e-mail du formulaire d'ajout était étiqueté "optionnel" alors que le schéma de validation partagé avec la route client exige un identifiant — corrigé. ADR-0029 actée. 5 nouveaux tests backend (218 au total, 36 fichiers verts). Build et lint propres. Restant : pas de recherche de joueur existant (V2/Legacy) depuis cet écran, seul nom + e-mail d'invitation ; pas de message explicite si la capacité du terrain limite l'ajout (même limitation déjà documentée côté client, ADR-0026).

---

## Frontend Lot 12 — Planning en grille horaire

**Statut : fait et vérifié en direct dans un vrai navigateur.** Remplace la liste de cartes empilées de `/admin/planning` par une grille horaire type "resource calendar" (terrains en colonnes, créneaux de 30 min en lignes, fenêtre 07h-23h étendue automatiquement si une réservation réelle déborde), inspirée du patron standard du secteur (Doinsport et consorts — page réelle inaccessible sans compte, patron confirmé via leur documentation d'aide publique). Grille CSS pure (`display: grid`, dimensions calculées en `style` inline), aucune bibliothèque de calendrier tierce introduite. Les cases occupées affichent un bloc coloré par statut (vert confirmé, orange en attente, rouge révision manuelle), cliquable vers le détail réservation ; les cases vides sont cliquables et redirigent vers `/admin/bookings/new?courtId=&date=&time=`, qui pré-remplit désormais type de terrain/terrain/date/créneau une fois le client choisi (nouveaux paramètres de recherche lus via `useSearchParams`, page enveloppée dans `Suspense` comme les autres écrans du même patron). Aucune vérification de disponibilité par cellule (coûteux pour un gain marginal) : le formulaire de création revérifie de toute façon avant de proposer le créneau. Réservations `CANCELED` exclues de la grille (le créneau est réellement libre). Vérifié en direct de bout en bout : grille affichée avec les 4 terrains, clic sur une case vide → formulaire pré-rempli (terrain/date/créneau tous corrects), réservation créée (24,00 €), bloc apparu dans la grille en occupant exactement les deux demi-heures de la réservation, clic sur le bloc → détail réservation. ADR-0030 actée. Aucun changement backend, 218 tests inchangés. Build et lint propres. Restant : fenêtre horaire fixe plutôt que les vraies heures d'ouverture par terrain (un terrain fermé affiche quand même des cases cliquables, qui échoueraient simplement à la création) ; pas de gestion visuelle de chevauchement si deux réservations occupent accidentellement le même créneau.

---

## Frontend Lot 13 — Revue admin des conflits de migration Doinsport

**Statut : fait et vérifié en direct dans un vrai navigateur.** `/admin/legacy-clients` (voir ADR-0034) : écran de revue des `LegacyClient` en `MERGE_REQUIRED` (CDC §7.5 — "validation manuelle administrateur en cas de conflit"), filtrable par statut de migration. Trois actions par fiche : lier manuellement à un compte V2 (recherche client existante réutilisée telle quelle), rejeter (`DISABLED`, motif conservé), remettre en attente (`LEGACY_ONLY`, relance la déduplication automatique au prochain import). Lier/rejeter interdits depuis un statut déjà résolu sans `reset` explicite — évite qu'un second clic écrase silencieusement un lien déjà posé. Vérifié en direct de bout en bout : client en conflit inséré, recherché via le picker existant, lié à un compte V2, disparu de l'onglet "Conflit à valider", réapparu sous "Migré" avec le lien affiché, action tracée dans l'audit log. ADR-0034 actée. 7 nouveaux tests backend (244 au total, 40 fichiers verts). Build et lint propres. Restant : pas de score de correspondance affiché à côté des candidats potentiels, pas de lien direct depuis le `mergeNote` vers les comptes V2 qu'il cite.

**Mise à jour — tableau de bord `LegacySyncRun` (voir ADR-0034 addendum).** L'écran `/admin/sync` existant (CDC §55 écran 21, anomalies de synchro V2→Doinsport) reçoit une seconde section "Imports récents", listant les 20 dernières exécutions du script d'import (ADR-0032) — jusqu'ici visibles uniquement en base ou dans les logs serveur. `LegacyMigrationAdminService.listSyncRuns(limit)` (nouvelle méthode) + `GET /admin/legacy-sync-runs` (STAFF). Regroupé sur l'écran existant plutôt qu'un nouvel écran/lien de nav, les deux sections couvrant la même santé de synchro Doinsport sans partager de données. Vérifié en direct : deux runs insérés (un `SUCCESS` clients, un `PARTIAL` réservations avec résumé d'erreur), les deux affichés correctement avec statut coloré, horodatage et compteurs. 1 nouveau test backend (245 au total, 40 fichiers verts). Build et lint propres. Restant du Lot 11 : scheduler récurrent (toujours pas de pg-boss), flux de rédemption de `ClientMigrationInvitation`.

**Mise à jour — scheduler récurrent construit et vérifié en conditions réelles (voir ADR-0035).** `LegacySyncScheduler` fait enfin tourner `LEGACY_SYNC_ENABLED`/`LEGACY_SYNC_INTERVAL_SECONDS`/`LEGACY_RECONCILIATION_INTERVAL_SECONDS`, en configuration depuis le Lot 0 mais jamais lus jusqu'ici. Deux cycles indépendants (CDC §15.3) : sync fréquente (réservations seules, fenêtre `-1h/+30j`, 60 s par défaut) et réconciliation (clients + réservations, fenêtre `-1j/+1an`, 300 s par défaut) — logique d'import extraite du script CLI dans `legacy-import.service.ts`, partagée entre les deux plutôt que dupliquée. Garde anti-chevauchement simple (cycle sauté si le précédent du même type tourne encore, rattrapé au tick suivant) plutôt qu'une vraie file d'attente. Démarré uniquement depuis `server.ts` (jamais `app.ts`, partagé avec le harnais de test — la suite d'intégration ne doit jamais déclencher de vrai appel réseau Doinsport en arrière-plan), avec repli silencieux si `LEGACY_SYNC_ENABLED=false` ou identifiants Doinsport absents. Vérifié en conditions réelles de bout en bout : serveur démarré avec les vraies clés Doinsport, scheduler démarré (log confirmé), premier cycle de sync fréquente déclenché exactement 60 s plus tard contre l'API réelle, 49 réservations listées et importées (`LegacySyncRun` tracé `SUCCESS`), données réelles nettoyées ensuite. 5 nouveaux tests backend (250 au total, 41 fichiers verts).

**Mise à jour — flux de rédemption de l'invitation de migration construit et vérifié en conditions réelles (voir ADR-0036).** `MigrationInvitationService` couvre les étapes 3-8 du CDC §7.3 : bouton "Inviter à migrer" sur `/admin/legacy-clients` (déclenchement admin, jamais automatique à l'import — cohérent avec la migration par cohortes de `docs/migration.md`), e-mail avec lien unique à durée limitée (`CLIENT_MIGRATION_INVITATION_TTL_HOURS`, 168h par défaut), nouvelle page publique `/migrate?token=` (préremplissage de l'identité, choix du mot de passe), compte V2 créé `ACTIVE` directement (la possession du lien vaut vérification d'e-mail, CDC §7.3 étape 5 — pas de double vérification), Shadow Client lié et repassé `MIGRATED`. `assertPasswordStrength` extraite d'`IdentityService` vers `identity/password.ts`, partagée entre inscription, reset et migration plutôt que dupliquée. Vérifié en direct de bout en bout : client `LEGACY_ONLY` inséré, invitation envoyée, lien récupéré depuis les logs serveur, formulaire de mot de passe rempli dans un contexte déconnecté, compte créé, connexion immédiate réussie sans étape supplémentaire, fiche repassée "Migré" côté admin. 9 nouveaux tests backend (259 au total, 42 fichiers verts). Build et lint propres. **Le Lot 11 (import + synchro Doinsport) est désormais intégralement complet** : modèle de données, import initial, anti-collision Dual Run, écran de revue, tableau de bord, scheduler récurrent et flux de rédemption tous construits et vérifiés en conditions réelles.

---

## Après le Lot 10 — Migration par cohortes et cutover

Suivre `docs/migration.md` : Phase 1 (interne) → Phase 2 (pilote) → Phase 3 (extension) → Phase 4 (généralisation) → Phase 5 (cutover) → Phase 6 (extinction), chacune gouvernée par les critères du CDC §51 et non par une simple impression de stabilité.

Le cutover final n'est déclenché qu'après passage complet de la **checklist Annexe C** (aucun paiement orphelin, aucun hold orphelin, frais SPLIT validés juridiquement, rollback testé, `LEGACY_WRITE_ENABLED=false` validé en conditions réelles, etc.).

---

## Vue d'ensemble

| Lot | Contenu | Statut |
|---|---|---|
| 0 | Dossier de projet | fait |
| 1 | Fondations | fait |
| 2 | Legacy adapter | fait (cœur) |
| 3 | Booking core | fait |
| 4 | Payments online/FULL | fait (sans clé Stripe réelle) |
| 5 | Wallet/crédits | fait (sans clé Stripe réelle) |
| 6 | SPLIT | fait (sans clé Stripe réelle) |
| 7 | Kiosque/Terminal | fait (QR handoff ; Terminal posé, non câblé) |
| 8 | Access/Notifications | fait |
| 9 | Back-office (API) | fait — écrans admin restants |
| 10 | Pilot hardening (backend) | fait |
| 11 | Import + synchro + migration d'identité Doinsport | fait (modèle, import, anti-collision, revue admin, tableau de bord, scheduler, rédemption invitation) |
| Frontend 1 | Fondations Next.js + parcours FULL | fait |
| Frontend 2 | Parcours SPLIT | fait |
| Frontend 3 | Wallet / crédits prépayés | fait |
| Frontend 4 | Profil et moyens de paiement | fait |
| Frontend 5 | Kiosque / QR handoff | fait |

**Les 11 lots backend et les 13 lots frontend décrits ci-dessus sont tous committés et testés** (259 tests backend verts en CI, 42 fichiers, voir chaque section pour le détail de ce qui reste par lot). Les 25 écrans admin, les écrans client/kiosque secondaires, le changement d'e-mail, le rapport de chiffre d'affaires, l'écran de revue de migration Doinsport, le tableau de bord des imports, le scheduler récurrent et le flux de rédemption de l'invitation de migration sont désormais construits. Ce qui bloque encore un vrai pilote : un compte Stripe réel pour Ardenne Padel (aucun parcours de paiement n'a été validé en conditions réelles, tout se dégrade proprement en 503, à l'exception des paiements 100 % wallet — réellement aboutis en direct), les validations juridiques/comptables V-018 à V-024 (frais SPLIT, TVA crédits — hors code), et la migration par cohortes et le cutover (`docs/migration.md`). La synchro et la migration d'identité Doinsport (modèle de données, script d'import, anti-collision Dual Run, écran de revue, tableau de bord, scheduler récurrent et flux de rédemption) sont intégralement posées et vérifiées en conditions réelles (Lot 11/ADR-0031-0036) — `LegacyBooking`/`LegacyClient` sont désormais tenus à jour automatiquement (sync fréquente 60 s, réconciliation 300 s) tant que l'API tourne avec `LEGACY_SYNC_ENABLED=true`, et un admin peut inviter n'importe quel client `LEGACY_ONLY` à créer son compte V2 en un clic.

## Ce qui ne doit pas être développé maintenant (rappel §4)

Réseau social complet, messagerie instantanée, marketplace, moteur de recommandation, gamification/ELO, tournois complexes, computer vision, coaching IA, caisse/restaurant, apps natives Android/iOS, microservices, event streaming distribué, data warehouse, moteur de règles générique.

## Prochaines actions immédiates

1. **Ouvrir un compte Stripe réel pour Ardenne Padel** (test puis live) et confirmer les moyens de paiement locaux disponibles — bloque la validation en conditions réelles de tous les parcours de paiement (FULL, SPLIT, wallet, Terminal) déjà développés mais jamais exercés avec de vraies clés (V-011 à V-017).
2. ~~Construire les 25 écrans admin du CDC §55~~ — fait (Frontend Lots 6-7, ADR-0024/0025).
3. ~~Compléter les écrans client/kiosque secondaires~~ — fait (Frontend Lot 8, ADR-0026). ~~Changement d'e-mail~~ — fait (Frontend Lot 9, ADR-0027).
4. Trancher les points juridiques/comptables en attente (V-018 à V-024 : TVA sur les crédits, wording du frais SPLIT à faire valider pour ne jamais être assimilé à une surcharge carte interdite en Belgique) — n'a pas bloqué le développement (CDC §100) mais bloque l'activation commerciale. **V-018 (TVA) partiellement clos** : taux confirmés par le comptable (BDO) pour l'ensemble des recettes du club, voir [`docs/tva.md`](docs/tva.md) — le périmètre actuellement couvert par la plateforme (réservations + wallet) est intégralement au taux de 6 %, aucun changement de schéma requis aujourd'hui. Restent en attente côté comptable : traitement définitif de la licence AFP et éventuel changement de taux boissons non-alcoolisées (01/03/2026) ; V-019 à V-024 toujours ouverts.
5. Une fois Stripe configuré : lancer la Phase 1 (interne) de la migration par cohortes décrite dans `docs/migration.md`, en suivant la checklist Annexe B/C avant tout cutover.
