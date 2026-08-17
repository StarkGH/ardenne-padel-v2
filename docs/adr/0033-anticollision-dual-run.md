# ADR 0033 — Anti-collision Dual Run : occupations Legacy dans le calcul de disponibilité

## Statut
Accepté

## Date
2026-08-17

## Contexte

CDC §10.3 est explicite depuis le début du projet : *"pendant `LEGACY_DUAL_RUN=true`... les réservations Doinsport sont intégrées comme occupations externes... un créneau n'est disponible que si aucune source ne l'occupe."* `AvailabilityRepository.findOccupyingBookings` portait déjà un commentaire depuis le Lot 3 anticipant ce besoin ("y compris, dès qu'il existera, les réservations Legacy synchronisées localement") mais ne l'a jamais fait : la requête ne lisait que la table `Booking` V2. Avec `LegacyBooking` peuplé (Lot 11, ADR-0031/0032), plus rien ne manquait pour le brancher.

## Décision

### Fusion des deux sources dans `findOccupyingBookings`, pas un nouveau point d'entrée

`AvailabilityRepository.findOccupyingBookings` exécute désormais deux requêtes en parallèle (`Booking` V2 filtré par statuts actifs, `LegacyBooking` filtré `canceled: false`) et retourne leur concaténation — même forme `{startAt, endAt}` pour les deux, consommée telle quelle par `AvailabilityService`/`computeAvailableSlots`, qui attendait déjà "une seule liste, peu importe la source" d'après son propre commentaire (`slot-calculator.ts`, présent depuis sa création). Aucun changement de signature, aucun nouvel appelant à mettre à jour.

### Chevauchement V2/Legacy accepté sans déduplication

Une réservation créée côté V2 pendant le Dual Run est elle-même écrite dans Doinsport (CDC §16.1) — donc potentiellement réimportée plus tard dans `LegacyBooking` par le script de synchro, créant un doublon fonctionnel de la même occupation réelle. Pas de déduplication ajoutée : `computeAvailableSlots` bloque un créneau dès qu'*une* plage bloquée le chevauche, deux plages identiques ou qui se recouvrent ne changent rien au résultat. Un test dédié couvre explicitement ce cas pour éviter qu'une régression future suppose l'exclusivité des deux sources.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Un nouveau endpoint/méthode dédiée pour les occupations Legacy, appelée séparément par le service | `computeAvailableSlots` attend déjà une seule liste fusionnée — dupliquer l'appel aurait juste déplacé la fusion sans bénéfice |
| Déduplication des réservations V2 déjà synchronisées vers Legacy avant de les recompter | Complexité ajoutée pour un cas déjà neutre fonctionnellement (un chevauchement redondant ne change pas le résultat du blocage) |

## Conséquences

**Positif :** vérifié par 5 nouveaux tests d'intégration (`availability.service.test.ts`) — un `LegacyBooking` seul bloque bien le créneau, une réservation Legacy annulée ne bloque rien, une réservation V2 seule continue de bloquer (non-régression), le chevauchement V2+Legacy sur le même créneau ne casse rien, une réservation Legacy sur un autre terrain ne fuit pas. Vérifié aussi en conditions réelles contre le serveur de dev (ligne insérée manuellement, créneau confirmé absent de `GET /availability`, y compris la vérification croisée de fuseau horaire — l'heure de blocage effective correspond bien à la conversion Europe/Brussels déjà appliquée partout ailleurs dans le calcul). 237 tests au total, 39 fichiers verts.

**Négatif / dette assumée :** `LegacyBooking` n'est à jour qu'au rythme du dernier import manuel (`npm run import:legacy`, pas de scheduler) — l'anti-collision Dual Run reste donc décalée dans le temps par rapport à la réalité Doinsport, jamais garantie à la seconde près (déjà le cas de toute façon : CDC §10.3 rappelle que l'affichage de disponibilité "n'est jamais une garantie", l'arbitre final restant le POST Doinsport au moment de la confirmation).
