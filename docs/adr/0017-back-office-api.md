# ADR 0017 — API back-office (Lot 9)

## Statut
Accepté

## Date
2026-08-14

## Contexte

Le CDC §39 (dashboard, actions rapides, indicateurs de santé), §40-§41 (CRM/historique client), §55 (25 écrans admin) et §58 (audit log) décrivent un back-office complet. Aucun frontend n'existe dans ce projet à ce stade — tous les lots précédents (0 à 8) sont exclusivement backend (API Node/Express/Prisma). Construire "25 écrans" est un travail frontend, pas backend, et sort du périmètre de cette session.

## Décision

### Le Lot 9 livre l'API que consommeraient ces écrans, jamais les écrans eux-mêmes

Décision explicite, symétrique à celle du Lot 7 pour l'écran kiosque : le CDC décrit un livrable produit (dashboard, fiches, écrans), cette session livre l'API backend qui le rendrait possible. Chaque endpoint créé correspond à un besoin fonctionnel précis du §39-§41-§58, jamais à une supposition. Ce qui n'est pas construit : le rendu visuel, la timeline planning, les 25 écrans listés au §55.

### `AuditLogService` — append-only, avant/après expurgé, jamais modifiable

CDC §58 liste les actions à auditer et les champs requis (acteur, action, cible, before/after expurgé, raison, contexte, horodatage) — `AuditLog` existait déjà dans le schéma depuis le Lot 0 mais n'était jamais écrit. `AuditLogService.record()` est la seule porte d'entrée ; aucune méthode de suppression/mise à jour n'est exposée. Une liste `SENSITIVE_KEYS` (mots de passe, hash de clé, ciphertext de code d'accès...) expurge automatiquement les payloads avant/après — jamais une hypothèse silencieuse sur ce qui est sûr à logguer, une liste explicite à étendre au besoin.

### Chaque mutation admin passe par un service qui audite, jamais la route directement

`SchedulingAdminService`, `CreditPackAdminService`, `BookingsAdminService`, `PaymentsAdminService`, `CrmService` encapsulent chacun un domaine et appellent `AuditLogService.record()` en fin de mutation. Aucune route n'écrit directement dans une table métier sans passer par un de ces services — garantit qu'aucune action sensible ne peut être ajoutée sans qu'un audit log l'accompagne.

### `BookingsAdminService` duplique volontairement une petite portion de `BookingsService.cancelBooking`

Plutôt que d'ajouter un flag `adminOverride` à `BookingsService` (aurait exigé de modifier sa signature et tous ses points d'instanciation — app.ts et trois fichiers de test), `BookingsAdminService.adminCancel` réimplémente la séquence d'annulation (CANCEL_PENDING -> annulation Legacy si applicable -> CANCELED -> révocation d'accès -> notification), sans les deux garde-fous réservés au client (organisateur uniquement, délai d'annulation opposable). La duplication reste petite (~25 lignes) et le message est clair : ce chemin est délibérément différent du chemin client, pas un raccourci accidentel.

### "Forcer resync" ne rejoue jamais aveuglément l'écriture Legacy

CDC §39.2 liste "forcer resync" comme action rapide admin. Rejouer `createBookingInLegacy` sur une réservation dont le statut de sync est `CONFIRMATION_UNKNOWN` risquerait de créer un doublon si la réservation existe déjà côté Doinsport (CDC §16.2 : "jamais voider/libérer aveuglément" s'applique symétriquement à "jamais recréer aveuglément"). `forceResync` se limite donc à remettre `syncStatus` à `PENDING` (une marque de reprise), sans exécuter d'appel Legacy immédiat — l'exécution réelle attend une vraie infrastructure de job (dette déjà documentée depuis les Lots 4/7/8).

### "Frais provider anormaux" n'est pas calculé

Sur les dix indicateurs du §39.3, neuf sont des comptages directs sur un statut déjà modélisé (paiements échoués, holds actifs, packs payés non crédités, etc.). Le dixième — "frais provider anormaux" — suppose un seuil ou une moyenne de référence qu'aucune partie du CDC ne définit. Fabriquer une règle métier non spécifiée serait exactement l'anti-pattern que le CDC proscrit explicitement (§111, "hypothèse silencieuse") : mieux vaut une lacune documentée qu'un seuil inventé.

### RBAC : STAFF pour consulter, ADMIN pour modifier une configuration, SUPER_ADMIN pour changer un rôle

Cohérent avec la hiérarchie `CUSTOMER < STAFF < ADMIN < SUPER_ADMIN` déjà définie (Lot 1). Consultation (CRM, indicateurs de santé, listes de config) : STAFF suffit — c'est le quotidien d'un accueil de club. Mutation d'une configuration qui affecte tous les clients (tarif, horaire, pack de crédits, annulation admin, remboursement) : ADMIN. Changement de rôle d'un utilisateur — la seule action qui peut s'auto-accorder des privilèges : SUPER_ADMIN uniquement.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Construire un frontend minimal pour au moins un écran (ex. dashboard) | Aurait demandé d'initialiser tout un projet Next.js dans cette même session, très éloigné du reste du travail backend ; mieux vaut une API complète et testée que deux surfaces à moitié faites |
| Ajouter un flag `adminOverride` à `BookingsService.cancelBooking` | Aurait forcé à modifier la signature du constructeur (déjà 7 paramètres) et tous ses points d'instanciation existants pour un besoin isolé au back-office |
| Rejouer immédiatement `createBookingInLegacy` sur "forcer resync" | Risque de doublon Legacy en cas d'état réellement déjà confirmé côté Doinsport — contraire à la prudence déjà actée pour les erreurs ambiguës (CDC §16.2) |
| Inventer un seuil pour "frais provider anormaux" (ex. ±20 % de la moyenne) | Hypothèse métier non demandée par le CDC — décision commerciale à valider avec le club, pas à deviner |

## Conséquences

**Positif :** journal d'audit réellement alimenté pour la première fois (Lots 0-8 avaient le schéma mais aucune écriture). CRM, configuration tarifs/horaires/fermetures, credit packs, remboursements (le `RefundService` du Lot 4 est enfin monté sur une route), dashboard planning et indicateurs de santé tous fonctionnels et testés (29 tests dédiés, 161 au total). Un vrai gap corrigé au passage : `TerminalDevice` (Lot 7) n'était jamais nettoyé entre fichiers de test, provoquant une pollution inter-tests découverte en écrivant les tests d'indicateurs de santé — corrigé dans `reset-db.ts`.

**Négatif / dette assumée :** aucun écran admin construit (frontend entièrement hors périmètre de cette session, Next.js jamais initialisé). "Forcer resync" ne fait que marquer pour reprise, l'exécution réelle attend une infrastructure de job. "Frais provider anormaux" non calculé. Le module `kiosk` (Lot 7) n'a toujours pas d'endpoint de révocation de dispositif exposé par une route (juste `revoke()` au niveau service) — gap pré-existant, non ajouté ici pour ne pas élargir davantage un lot déjà large.
