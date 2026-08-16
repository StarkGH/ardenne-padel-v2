# ADR 0025 — Parcours frontend Admin (deuxième tranche : les 18 écrans restants)

## Statut
Accepté

## Date
2026-08-16

## Contexte

ADR-0024 avait livré une première tranche de 7 écrans admin (Login, Dashboard, Planning, Détail/Création réservation, Clients, Fiche client) sur les 25 du CDC §55. Ce lot construit les 18 restants : Tarifs, Horaires/fermetures, Wallets, Crédit/débit wallet avec motif, Packs de crédits, Achats de crédits, Holds de wallet, Paiements/remboursements, Coûts provider réels, Configuration paiement partagé, Configuration frais de service split, Kiosks, Terminaux Stripe, Synchronisation Doinsport, Accès, Incidents/Manual Review, Audit log, Paramètres.

Contrairement à la première tranche (où l'API back-office du Lot 9 couvrait presque tout), la moitié de ces écrans n'avaient **aucun** support backend : certaines capacités existaient au niveau service mais n'étaient reliées à aucune route HTTP (`WalletService.creditAdmin`, `releaseHold`, `captureHold` ; `AuditLogRepository.listRecent`), d'autres n'existaient pas du tout (liste globale des paiements, des achats de crédits, des accès, gestion des terminaux Stripe, révocation d'un kiosque).

## Décision

### 1. Neuf ajouts backend, chacun minimal et justifié par un écran précis

- **`GET/POST /admin/wallets/:id/{credit,debit}`, `GET /admin/wallets/:id/holds`, `POST /admin/wallet-holds/:id/{release,capture}`** (nouveau `WalletAdminService`) — `creditAdmin`/`releaseHold`/`captureHold` existaient déjà dans `WalletService` mais n'étaient jamais montés sur une route (dette explicitement documentée dans le research de ce lot). `debitAdmin` est en revanche une méthode entièrement nouvelle : aucun débit manuel hors réservation n'existait, seulement `debitForBooking` (toujours lié à un booking). Réutilise `allocateAcrossOrigins` (bonus d'abord) exactement comme le débit de réservation, pour ne pas introduire une deuxième politique de répartition.
- **`GET /admin/audit-log`** (nouveau `audit-log.routes.ts`) — `AuditLogRepository.listRecent` acceptait déjà des filtres optionnels mais n'était exposé par aucune route ; le journal (append-only, jamais modifiable) était donc invisible depuis l'extérieur du code.
- **`GET /admin/settings`** (nouveau `settings.routes.ts`, SUPER_ADMIN) — instantané en lecture seule d'`AppConfig`. La configuration reste 100 % par variable d'environnement, validée une seule fois au démarrage (`loadConfig`) : il n'existe aucun modèle de paramètres persisté ni de mécanisme de rechargement à chaud. Construire un vrai système d'édition (table `Settings`, lecture avec override DB-puis-env, invalidation de cache) aurait été disproportionné pour ce lot — un instantané en lecture seule donne déjà une vraie valeur (visibilité sur la configuration active) sans engager cette refonte. Couvre à la fois les écrans 17 (config split), 18 (config frais split) et 25 (paramètres généraux) : ce sont, au niveau des données, le même objet de configuration plat, les séparer en trois écrans aurait dupliqué l'affichage sans dupliquer la substance.
- **`POST /admin/kiosk-devices/:id/revoke`** — `KioskDeviceService.revoke` existait, non routée (gap documenté dans ADR-0017).
- **`POST /admin/terminal-devices`, `GET /admin/terminal-devices`, `POST /admin/terminal-devices/:id/revoke`** (nouveau `terminal-admin.routes.ts`) — aucune route n'existait pour enregistrer un `TerminalDevice` ; seul `listActive()` et un `touchLastSeen()` interne au flux kiosque existaient. Mêmes rôles et même forme que les dispositifs kiosque, pour rester cohérent.
- **`GET /admin/credit-pack-purchases`** — nouvelle méthode `listAllPurchases` sur `CreditPacksRepository`, seule vue globale des achats (jusqu'ici uniquement visibles un par un via la fiche client).
- **`GET /admin/payments`** — nouvelle méthode `listRecent` sur `PaymentsRepository`, incluant `providerFeeCents`/`providerNetCents` déjà présents en base mais jamais exposés en liste (couvre à la fois écran 15 et 16 — ce sont les mêmes lignes, l'écran 16 n'est qu'une lecture différente des mêmes colonnes).
- **`GET /admin/access-grants?from&to`** — nouvelle méthode `listAccessGrantsInRange` sur `BookingsRepository`, **volontairement distincte** de `findById`/`listInRange` (voir §2).

### 2. Un risque de fuite de données évité avant qu'il n'atteigne le code committé

Le premier réflexe pour l'écran 22 (Accès) a été d'ajouter `accessGrants: true` aux `include` de `BookingsRepository.findById`/`listInRange` — la manière la plus directe de faire remonter les codes d'accès jusqu'au planning admin. Ce chemin a été abandonné avant commit : ces deux méthodes sont **aussi** utilisées par `GET /bookings/:id` côté client (CDC, tout utilisateur authentifié organisateur de la réservation). `AccessGrant.codeCiphertext`/`codeIv` auraient alors transité, même chiffrés, jusqu'à une réponse HTTP client — exactement le genre d'exposition de matériel cryptographique que le CDC §57.1 proscrit. La solution retenue est une projection Prisma `select` séparée (`listAccessGrantsInRange`), qui n'expose jamais ces deux champs et n'est appelée que par la route admin STAFF+.

### 3. Wallets (10), crédit/débit (11), holds (14) : un seul écran de gestion, pas trois

Le wallet est intrinsèquement lié à un client : il n'existe pas de "liste de tous les wallets" au sens Stripe-dashboard, seulement "le wallet de X". L'écran "Wallets" (10) est donc une simple recherche client (réutilise `GET /admin/clients?q=`, même endpoint que l'écran 6) qui mène vers `/admin/clients/[userId]/wallet` — un unique écran qui couvre en réalité le solde, le crédit/débit avec motif (11) *et* les garanties (14), plutôt que trois pages qui se seraient renvoyées les unes aux autres pour afficher le même wallet. Un lien "Gérer le wallet" a été ajouté à la fiche client (écran 7) pour la découvrabilité.

### 4. Synchronisation Doinsport (21) et Incidents/Manual Review (23) : filtres sur une liste existante, pas de nouvel endpoint

Ni l'un ni l'autre n'est un concept backend distinct : `LegacyBookingMapping.syncStatus` en anomalie et `Booking.status === "MANUAL_REVIEW"` sont déjà présents dans les lignes renvoyées par `GET /admin/bookings?from&to` (planning admin, écran 3). Les deux écrans réutilisent cet unique endpoint et filtrent côté client sur une fenêtre large (7j passés/14j futurs pour la sync, 30j/14j pour les incidents) — cohérent avec le choix déjà documenté dans ADR-0017 de ne pas construire de pagination/agrégation supplémentaire sur cet endpoint pour cette phase.

### 5. Un bug trouvé et corrigé pendant les tests d'intégration : pollution de la base de dev par un test mal nettoyé

Le nouveau fichier `admin-remaining.routes.test.ts` créait un court (`test-padel-access-admin`) pour son test sur l'écran 22 sans jamais le supprimer dans un `afterAll` — contrairement à la convention déjà établie par tous les autres fichiers de test d'intégration du projet. Le court est resté visible dans l'écran "Tarifs" en conditions réelles pendant la vérification en direct (mélangé aux vrais terrains du club). Corrigé par un `afterAll` de nettoyage, et la ligne polluée supprimée manuellement de la base de dev partagée.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Construire un vrai système de paramètres persisté (table `Settings`, admin peut éditer et appliquer à chaud) pour les écrans 17-18-25 | Refonte disproportionnée pour cette tranche — changerait la source de vérité de la configuration (aujourd'hui, `loadConfig()` unique et figée au démarrage) pour un besoin qu'un instantané en lecture seule couvre déjà en grande partie (visibilité) |
| Ajouter `accessGrants` aux méthodes `findById`/`listInRange` partagées avec le client | Aurait fait transiter `codeCiphertext`/`codeIv` jusqu'à une réponse HTTP client-facing (CDC §57.1) — une projection dédiée, jamais partagée avec le chemin client, élimine le risque structurellement plutôt que de compter sur la discipline de chaque appelant |
| Trois écrans séparés pour Wallets/Crédit-débit/Holds | Le wallet n'existe qu'au singulier pour un client donné — un seul écran de gestion évite un aller-retour entre trois pages qui afficheraient toutes le même wallet |
| Endpoints dédiés pour la synchro Legacy et les incidents (au lieu de filtrer le planning existant) | Ni l'un ni l'autre n'est un concept de données distinct côté backend — dupliquer une requête déjà disponible aurait ajouté de la surface sans ajouter de capacité réelle |

## Conséquences

**Positif :** les 18 écrans construits et vérifiés — 15 en direct dans un navigateur réel avec un compte SUPER_ADMIN (tarifs créés/désactivés, horaires/fermetures créées/supprimées, wallet crédité/débité/garanti/libéré sur un vrai compte, packs de crédits, paiement remboursé avec dégradation `STRIPE_NOT_CONFIGURED` cohérente avec le reste du site, kiosque et terminal enregistrés puis révoqués, journal d'audit filtrable montrant une trace réelle et complète de toutes les actions ci-dessus, paramètres affichant la configuration réellement active du serveur), 3 en état vide confirmé par ailleurs par un test d'intégration route-level couvrant le cas non-vide (achats de crédits, accès — y compris la non-fuite du chiffré —, synchronisation). Gating de rôle SUPER_ADMIN pour Paramètres confirmé par un test automatisé (403 pour STAFF/ADMIN). 11 nouveaux tests backend (206 au total, 35 fichiers), build et lint propres.

**Négatif / dette assumée :** Paramètres reste strictement en lecture seule — toute modification continue de nécessiter un changement de variable d'environnement et un redéploiement, pas d'édition depuis l'admin. Terminaux Stripe est un inventaire administratif, pas un appairage matériel réel (le point différé d'ADR-0014, V-014, reste inchangé). Synchronisation Doinsport et Incidents sont bornés à une fenêtre de dates fixe (pas de recherche libre sur tout l'historique). Note indépendante : une classe de tests backend préexistante et intermittente (`split-checkout.service.test.ts`, ~50 % d'échec en suite complète, 100 % de réussite en isolation) a été identifiée pendant ce lot — confirmée sans lien avec les changements de ce lot (le fichier isolé passe systématiquement), distincte du bug de date-limite déjà corrigé sur `bookings.http.integration.test.ts`/`concurrency.test.ts`. Non traitée ici : la cause probable est une interaction entre fichiers de test partageant la même base (isolation/concurrence), pas un défaut de logique métier — signalée pour investigation dédiée plutôt que corrigée dans la précipitation.
