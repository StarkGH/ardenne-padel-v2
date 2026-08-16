# ADR 0024 — Parcours frontend Admin (première tranche : opérations)

## Statut
Accepté

## Date
2026-08-16

## Contexte

Le CDC §55 liste 25 écrans admin. Le Lot 9 backend (ADR-0017) avait délibérément construit l'API back-office sans aucun frontend, pour éviter "deux surfaces à moitié finies". Ce lot construit une première tranche de 7 écrans — Login admin, Dashboard, Planning multi-terrains, Détail réservation, Création réservation, Clients, Fiche client — le cœur opérationnel quotidien du club, en laissant délibérément de côté les écrans de configuration (tarifs, horaires, wallets, packs, split, kiosks, terminaux, sync, accès, incidents, audit log, paramètres) pour une tranche ultérieure.

## Décision

### 1. Même authentification que le parcours client, gating par rôle côté frontend uniquement

Il n'existe aucun mécanisme d'auth "admin" distinct côté backend — `POST /auth/login` pose le même cookie de session pour tout le monde, seul `role` (`CUSTOMER < STAFF < ADMIN < SUPER_ADMIN`) change ce qu'un compte peut faire. `/admin/login` réutilise donc l'endpoint client, mais refuse et déconnecte immédiatement un compte `CUSTOMER` avec un message clair plutôt que de le rediriger vers un dashboard vide. `apps/web/src/app/admin/layout.tsx` porte ce même contrôle de rôle pour toutes les pages `/admin/*`, avec sa propre navigation (Tableau de bord / Planning / Clients), distincte de la barre de navigation client qui reste affichée au-dessus (aucune restructuration du layout racine — cohérent avec le choix déjà fait pour les écrans kiosque, ADR-0023, de rester dans la même application Next.js plutôt que d'en créer une seconde).

### 2. Deux ajouts backend minimaux, chacun justifié par un écran concret

- **`GET /admin/bookings/:id`** (STAFF+) — comblait un vrai trou : la seule route existante, `GET /bookings/:id` (client), refuse tout accès hors organisateur (403), inutilisable pour un admin consultant la réservation d'un tiers. Réutilise `BookingsRepository.findById` et enrichit avec l'identité de l'organisateur (jamais incluse par cette requête côté client).
- **`POST /admin/bookings`** (ADMIN+) — écran 5 "Création réservation" (téléphone/guichet) n'avait strictement aucun support : `POST /bookings` fixe toujours `organizerUserId` sur l'appelant connecté et ne peut donc jamais créer une réservation *pour* un client choisi. Le nouvel endpoint réutilise intégralement `BookingsService.createBooking` (même moteur de tarification/état que le client) avec `source: "ADMIN"` — une valeur déjà présente dans l'enum Prisma `BookingSource` mais jamais écrite avant ce lot. Chaque création est auditée (`BOOKING_ADMIN_CREATED`).

Les cinq autres écrans (Dashboard, Planning, Clients, Fiche client, et les actions d'annulation/resynchronisation de l'écran 4) consomment les endpoints déjà livrés au Lot 9 sans aucune modification.

### 3. Un bug trouvé et corrigé en cours d'implémentation, avant même la vérification en direct : le champ `pilotUser` manquant sur la fiche client

En écrivant l'écran 7, la bascule "cohorte pilote" (`PATCH /admin/clients/:userId/pilot-cohort`, déjà livrée au Lot 9) n'avait aucun moyen d'afficher l'état courant : `CrmRepository.findUserProfile` ne sélectionnait pas `pilotUser`. Plutôt que de livrer un bouton qui bascule un état qu'il ne peut pas lire (un bouton-vitrine, exactement le défaut évité pour l'écran Terminal du lot kiosque, ADR-0023), le `select` a été complété d'un champ — la fiche client sait maintenant afficher "Incluse"/"Non incluse" avant de proposer de basculer.

### 4. Planning multi-terrains : agenda vertical par terrain, pas une grille temporelle

`GET /admin/bookings?from&to` renvoie une liste plate (l'ADR-0017 le dit explicitement : "pas de timeline visuelle, c'est du frontend"). Plutôt qu'une grille pixel-positionnée (mise en page complexe, peu adaptée à la largeur `max-w-lg` mobile-first du layout partagé), l'écran groupe les réservations par terrain dans une colonne verticale scrollable — un choix de portée volontairement modeste, cohérent avec le reste de l'app, qui reste pleinement fonctionnel pour vérifier l'occupation d'une journée.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Application Next.js séparée pour l'admin | Duplique `SessionProvider`/`api.ts`/`ui.tsx` pour un gain d'isolation marginal ; le layout `/admin/*` suffit à distinguer visuellement et fonctionnellement l'espace équipe |
| Grille de planning pixel-positionnée avec chevauchements visuels | Complexité de mise en page disproportionnée pour cette première tranche ; l'agenda vertical par terrain couvre le besoin réel ("voir l'occupation du jour") sans startup cost UI |
| Endpoint de création réservation dédié qui duplique la logique de tarification | `BookingsService.createBooking` accepte déjà `source` en paramètre — dupliquer son contenu pour l'admin aurait risqué une divergence de calcul de prix entre client et admin (CDC §129, même principe que les lots précédents) |
| Ignorer le champ `pilotUser` manquant, livrer le bouton "Inclure" quand même | Aurait produit un bouton dont l'état affiché ne reflète jamais la réalité — corrigé avant vérification plutôt que découvert en direct |

## Conséquences

**Positif :** les 7 écrans vérifiés en direct dans un vrai navigateur avec un compte `admin@dev...` réel — refus propre d'un compte `CUSTOMER`, dashboard avec indicateurs et alertes réels (une alerte "kiosque hors ligne" authentique, provenant du dispositif seedé au Lot kiosque), planning affichant une réservation fraîchement créée, création de réservation pour un client existant (recherche → sélection → créneau → prix réel → création, `source: ADMIN` confirmé), détail réservation avec identité organisateur, fiche client complète (profil, historique, notes ajoutées et relues, bascule cohorte pilote fonctionnelle), gating de rôle confirmé (aucun bouton de changement de rôle affiché pour un compte `ADMIN` non `SUPER_ADMIN`). 4 nouveaux tests backend (`getById`, `adminCreate` × 2), 195 au total. Build et lint propres.

**Négatif / dette assumée :** 18 des 25 écrans admin restent à construire (tarifs, horaires/fermetures, wallets, crédit/débit avec motif, packs, achats, holds, paiements/remboursements, coûts provider, configuration split, kiosks, terminaux, sync Doinsport, accès, incidents/révision manuelle, audit log, paramètres). Planning limité à une vue journalière par terrain, sans détection visuelle de chevauchement. Pas de pagination sur `GET /admin/bookings` (hérité du Lot 9, non traité ici) — une plage de dates trop large pourrait renvoyer une liste volumineuse. Recherche client sans debounce (déclenchée par bouton/Entrée, pas de recherche en temps réel).
