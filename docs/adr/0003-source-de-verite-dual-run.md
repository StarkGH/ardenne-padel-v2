# ADR 0003 — Source de vérité pendant le Dual Run

## Statut
Accepté

## Date
2026-08-14

## Contexte

Pendant le Dual Run (CDC §2.2, §10.3), un créneau ne doit être présenté comme disponible que si aucune source (V2 ou Legacy) ne l'occupe, mais la garantie anti-collision finale reste le `POST /clubs/bookings` Doinsport (422 = créneau perdu, CDC §13.7, §47.3). Il fallait décider comment le module `availability` (Lot 3) construit son calcul sans dépendre d'un appel réseau Doinsport à chaque consultation.

## Décision

`AvailabilityService` calcule les créneaux à partir des **réservations déjà connues localement** (`bookings`, tous statuts actifs, indépendamment de leur `source`) — jamais d'appel direct à `LegacyBookingProvider.listBookings()` à la volée. Ce choix repose sur deux points explicites du CDC :

1. §10.3 : "Le calendrier peut utiliser un cache court, mais la disponibilité affichée n'est jamais une garantie."
2. §84/§85 : pas de polling agressif, cache autorisé pour la disponibilité à très court terme.

Conséquence directe : tant que la synchronisation périodique Legacy→V2 (CDC §15, Lot 8, dépend de pg-boss) n'existe pas, l'affichage de disponibilité V2 ne reflète **que** les réservations créées depuis V2 — pas les réservations prises directement dans Doinsport par des utilisateurs Legacy. C'est un angle mort assumé et documenté, pas une hypothèse silencieuse : l'arbitre final reste de toute façon le POST Doinsport au moment de la confirmation (CDC §18.1, §27.1), qui échouera avec un message clair (`BOOKING_SLOT_UNAVAILABLE`) en cas de collision réelle non détectée par le cache local.

Dès que le Lot 8 introduira la synchronisation périodique, les réservations Legacy seront matérialisées en local (`bookings.source = LEGACY_SYNC`) et apparaîtront automatiquement dans le calcul de disponibilité **sans modification** de `AvailabilityService` — la requête `findOccupyingBookings` ne filtre pas par `source`.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Appeler `listBookings()` en direct à chaque consultation de disponibilité | Viole CDC §84/§86 (pas de polling agressif), latence/fragilité ajoutée à un endpoint public sans authentification |
| Bloquer l'affichage de disponibilité tant que la sync Legacy n'existe pas | Bloquerait tout le Lot 3 sur une dépendance du Lot 8 ; le CDC autorise explicitement un calendrier "jamais une garantie" |

## Conséquences

**Positif :** Lot 3 livrable et testable sans attendre l'infrastructure de jobs. Migration transparente vers la vraie disponibilité Dual Run dès que le Lot 8 arrive.

**Négatif / dette assumée :** entre le Lot 3 et le Lot 8, un utilisateur V2 peut voir un créneau "disponible" déjà pris côté Doinsport par un utilisateur Legacy — géré uniquement par l'échec explicite du POST Doinsport au moment du checkout, jamais par une confirmation silencieuse.
