# ADR 0013 — Frais de service de répartition (SPLIT)

## Statut
Accepté pour le calcul et le snapshot ; le wording/traitement TVA reste à valider juridiquement avant activation commerciale (V-022, V-023 du CDC — non levés dans cette session)

## Date
2026-08-14

## Contexte

Le CDC §24 exige un frais de service configurable pour le SPLIT, jamais présenté comme un supplément lié au moyen de paiement (interdit en Belgique — §24.4), avec une allocation `ORGANIZER` ou `PRO_RATA`, et un snapshot au moment du choix SPLIT pour qu'un changement de configuration ultérieur n'affecte jamais une réservation déjà créée (§24.3).

## Décision

Le frais est calculé une seule fois, dans `computeSplitShares` (`split-calculator.ts`), à partir de la configuration (`SPLIT_SERVICE_FEE_ENABLED`/`_CENTS`/`_ALLOCATION`) lue **au moment de la création de la réservation** (`BookingsService.createBooking`) et stocké directement sur `bookings.split_service_fee_cents`/`split_service_fee_allocation` — jamais relu depuis la configuration au moment du checkout. `SplitCheckoutService` relit ces valeurs snapshotées, pas la configuration courante, garantissant qu'un changement de tarif entre la création et le paiement n'affecte jamais le montant déjà annoncé au client (CDC §24.5 : le client doit connaître le prix avant confirmation, sans surprise).

`ORGANIZER` fait porter tout le frais sur la première part (`shares[0]`, convention interne) ; `PRO_RATA` le répartit via `splitEvenly` — mêmes garanties anti-perte de centime que pour le prix du terrain lui-même (CDC §23.3).

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Calculer le frais au moment du checkout plutôt qu'à la création | Romprait le snapshot exigé par CDC §24.3 ; le client verrait un montant différent de celui annoncé pendant la réservation |
| Fusionner le frais dans `booking_base_price_cents` | Empêcherait de le distinguer clairement à l'affichage (CDC §24.5 : "Terrain / Service de paiement partagé / Total" sur des lignes séparées) et dans le reporting (§57.3) |

## Conséquences

**Positif :** le montant affiché à la création (`POST /bookings`) est garanti identique à celui effectivement facturé au checkout, aucune dépendance à l'état de la configuration entre les deux appels.

**Négatif / dette assumée :** le wording exact du frais et son traitement TVA/comptable ne sont pas validés juridiquement (CDC §100, V-022/V-023) — le calcul et le snapshot sont corrects, mais l'activation commerciale réelle du frais reste bloquée tant que cette validation n'a pas eu lieu, indépendamment de l'état technique.
