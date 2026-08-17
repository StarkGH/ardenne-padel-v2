# ADR 0028 — Rapport de chiffre d'affaires réservations (V-018)

## Statut
Accepté

## Date
2026-08-17

## Contexte

`docs/tva.md` documente les taux de TVA confirmés par le comptable (BDO) pour l'ensemble des recettes du club, et conclut que le périmètre actuellement couvert par la plateforme (réservations de terrain + wallet, dépensé exclusivement dessus) est intégralement au taux de 6 %. Un gap concret en ressortait : le comptable reconstitue aujourd'hui le chiffre d'affaires "Padel" manuellement pour l'insérer dans son template Excel mensuel — rien dans l'admin ne produit cet export.

## Décision

### 1. Reconnaissance du revenu sur `Booking.confirmedAt`, pas sur `Payment`

Une réservation payée à 100 % par wallet ne crée aucune ligne `Payment` (`CheckoutService`, confirmé par ADR-0021 : "réservation `CONFIRMED` sans passer par `paymentProvider.createPayment`"). Baser le rapport sur la table `Payment` aurait donc silencieusement sous-compté ces réservations. `Booking.confirmedAt` est le seul instant qui vaut pour toutes les voies de paiement (Stripe, wallet, mixte) sans exception à gérer.

### 2. Un taux unique, configurable plutôt que codé en dur

`BOOKING_VAT_RATE_PERCENT` (nouvelle variable, `packages/config/src/env.ts`, défaut 6 %) plutôt qu'une constante `0.06` dans le service. Cohérent avec la philosophie déjà énoncée en tête de ce fichier de config ("toute règle métier susceptible de changer est ici, jamais hardcodée dans le domaine") — et un taux de TVA peut légalement changer (l'e-mail du comptable évoque déjà un changement possible pour les boissons non-alcoolisées au 01/03/2026, signe que ces taux ne sont pas immuables).

### 3. Regroupement par jour, pas par mois

Le template comptable réel (`CQFD - template revenus T2 2026.xlsx`) a une ligne par jour du mois, pas une ligne par mois. Le rapport reproduit cette granularité plutôt qu'un total mensuel agrégé, pour que l'export CSV puisse être collé directement dans le template existant sans retraitement.

### 4. Regroupement en mémoire (JS), pas en SQL

`findMany` sur les réservations de la période puis agrégation en JS, plutôt qu'un `GROUP BY date_trunc('day', ...)` en SQL brut. À l'échelle d'un rapport admin (quelques centaines à quelques milliers de réservations par trimestre), la différence de performance est négligeable, et éviter le SQL brut garde le code portable et lisible — cohérent avec le reste du module admin (`HealthIndicatorsService` fait de même pour ses agrégats).

### 5. Export CSV client-side, pas un endpoint dédié

Le CSV est généré dans le navigateur à partir de la réponse JSON déjà chargée (`Blob` + lien de téléchargement), plutôt qu'un `GET .../bookings-revenue.csv` côté serveur. Un seul format d'export était nécessaire ; dupliquer la sérialisation côté backend pour un unique bouton n'aurait rien ajouté.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Baser le rapport sur `Payment.amountCents` (`purpose: BOOKING_FULL`/`BOOKING_SHARE`) | Sous-compte les réservations payées 100 % wallet, qui ne créent aucune ligne `Payment` |
| Regroupement mensuel uniquement | Le template comptable réel a une granularité journalière — un total mensuel aurait forcé un retraitement manuel avant collage dans l'Excel existant |
| Déduire les remboursements du chiffre d'affaires affiché | Complexifie significativement la requête (nécessite de relier `Refund` à la période de la réservation d'origine, pas du remboursement) pour un besoin non demandé ; documenté comme limitation explicite plutôt que traité en silence |
| `GROUP BY` SQL avec `date_trunc` | Pas de gain de performance mesurable à cette échelle ; le regroupement en mémoire reste plus lisible et cohérent avec `HealthIndicatorsService` |

## Conséquences

**Positif :** vérifié en direct — réservation créée et payée 100 % wallet comme donnée de test, écran atteint depuis un nouveau lien de menu "Chiffre d'affaires", totaux et ventilation TVAC/HTVA/TVA corrects (24,00 € → 22,64 € HTVA + 1,36 € TVA à 6 %), export CSV déclenché sans erreur console. 3 nouveaux tests d'intégration (213 au total, 36 fichiers verts). Build et lint propres.

**Négatif / dette assumée :** les remboursements ne sont pas déduits du chiffre d'affaires affiché — une réservation remboursée reste comptée au mois de sa confirmation (limitation documentée, pas un défaut caché). Pas d'export PDF/Excel natif, CSV uniquement. Ne couvre que la location de terrain : si le club vend un jour des bons cadeaux ou du matériel via l'application, ce rapport ne les couvrira pas sans extension (voir `docs/tva.md` §3.4).
