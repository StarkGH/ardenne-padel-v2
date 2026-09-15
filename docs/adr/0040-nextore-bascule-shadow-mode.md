# ADR 0040 — Bascule Nextore V2 en shadow mode

## Statut
Proposé (stratégie actée avec l'utilisateur le 2026-09-15 ; exécution non commencée — aucun des Lots B à K n'est exposé via un vhost public, cf. ADR-0039 et les lots eux-mêmes)

## Date
2026-09-15

## Contexte

Le CDC Nextore §44 interdit un big bang et exige une stratégie de bascule avec critères go/no-go et procédure de retour arrière. L'audit Phase 0 a établi que l'ancien Nextor (Doing Sport/Nextor) reste aujourd'hui la caisse réellement utilisée au bar, avec :

- un flux de données déjà établi vers `ardenne-padel-pnl` (imports `nextore_sales`, `nr_registers`/`nr_payments`/`nr_categories`/`nr_sales`) ;
- un volume réel mesuré : ~9 086 tickets sur 249 sessions (16/10/2025→14/09/2026), ~39,5 tickets/jour en moyenne, pics à 375 ;
- un terminal carte Loyaltek 9220/Europabank distinct du flux Stripe.

L'utilisateur a explicitement demandé un shadow mode (coexistence temporaire) plutôt qu'une bascule directe.

## Décision

### Shadow mode en trois phases, jamais de coupure sèche de l'ancien Nextor

**Phase 1 — Silencieux (aucune donnée réelle, déjà en cours).**
Lots B à K développés et déployés en staging uniquement (aucun vhost nginx, `docker-compose.staging.override.yml` publie les ports sur `127.0.0.1` exclusivement — état actuel de ce dépôt). L'ancien Nextor continue de fonctionner sans aucune modification.

**Phase 2 — Double saisie pilote (un service test réel, personnel volontaire).**
Nextore V2 exposé via un vhost `nextore.ardenne-padel.be` (staging → cohorte pilote), utilisé en parallèle de l'ancien Nextor par un ou deux membres du personnel volontaires, sur un service réel mais à faible enjeu (ex. un service calme en semaine). L'ancien Nextor reste l'unique caisse de référence pour la compta/PNL pendant cette phase — Nextore V2 n'alimente rien d'aval, c'est un test d'usage et de fiabilité technique uniquement.

Critères de sortie de Phase 2 (go vers Phase 3) :
- zéro incident de double-débit crédits ou de paiement perdu sur au moins 4 services pilotes consécutifs (vérifiable via `AuditLog` + `NextorePayment.idempotencyKey`) ;
- écart de caisse (`NextoreCashSession.varianceCents`) resté sous le seuil de justification (5 €, cf. `cash-session.service.ts`) sur ces mêmes services ;
- le personnel pilote confirme que le flux POS (ajout produit → paiement → clôture) est au moins aussi rapide que l'ancien Nextor en usage réel.

**Phase 3 — Nextore V2 caisse de référence, ancien Nextor en secours passif.**
Nextore V2 devient la caisse utilisée par défaut pour tout le service. L'ancien Nextor reste installé et fonctionnel (pas désinstallé) comme procédure de secours explicite en cas de panne (réseau, incident applicatif) — bascule manuelle vers l'ancien poste si nécessaire, documentée dans un runbook opérateur (à rédiger avec le personnel avant Phase 3, hors scope technique de cet ADR).

**Phase 4 — Extinction de l'ancien Nextor (après une période de confiance, ex. 4 semaines de Phase 3 sans recours au secours).**
Décision explicite de l'utilisateur, pas automatique. Le pipeline `ardenne-padel-pnl` doit alors être adapté : l'adapter `nextore-registers`/`import-nextore` (qui lit les exports de l'ancien Nextor) est remplacé par un export natif depuis Nextore V2 (`GET /admin/nextore/reports/*`, déjà disponibles depuis le Lot J) vers les mêmes tables PNL (`nextore_sales`, `nr_registers` etc.) ou un nouveau schéma équivalent — **hors scope du présent ADR**, à traiter comme un lot dédié une fois la Phase 3 validée en usage réel (le format exact dépendra de ce que la compta utilise concrètement à ce moment-là, cf. CDC §35 : "ne pas inventer, auditer et proposer").

### Critères go/no-go formels (à vérifier avant chaque transition de phase)

| Critère | Vérifiable via |
|---|---|
| Aucun double paiement | `NextorePayment` : une seule ligne `RECORDED` par `idempotencyKey`, contrainte unique DB (déjà garanti par construction, Lot E) |
| Aucun double débit crédits | `WalletTransaction` de type `DEBIT_NEXTORE_ACCOUNT` : somme cohérente avec les paiements `WALLET_CREDIT` correspondants |
| Écarts de caisse maîtrisés | `NextoreCashSession.varianceCents` sur les sessions réelles de la phase |
| Rapprochement carte fonctionnel | Taux d'entrées `MATCHED` (Lot I) sur les paiements carte de la phase — viser >95 % sans confirmation manuelle |
| Performance perçue acceptable | Retour qualitatif du personnel pilote (pas de métrique automatisée dans ce lot) |

### Procédure de retour arrière

À tout moment des Phases 2-3, revenir à l'ancien Nextor est **toujours possible sans perte de données** : l'ancien Nextor n'est jamais désinstallé avant la Phase 4, et les ventes/paiements déjà enregistrés dans Nextore V2 restent en base (aucune suppression) — un retour arrière signifie simplement "cesser d'utiliser Nextore V2 pour les nouveaux tickets", pas une opération technique de restauration.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Big bang (bascule immédiate, extinction simultanée de l'ancien Nextor) | Refusé explicitement par le CDC §44 et par l'utilisateur ; risque élevé sur un système financier sans période de confiance |
| Double contrôle permanent (les deux systèmes tournent indéfiniment en parallèle) | Charge de saisie double non soutenable pour le personnel au-delà d'une phase pilote courte |
| Migration progressive par type de produit (ex. bar d'abord, terrain ensuite) | Le CDC exclut explicitement la location de terrain du périmètre Nextore (déjà couvert par les réservations V2) — non applicable ici |

## Conséquences

**Positif :** aucune fenêtre où le club se retrouve sans caisse fonctionnelle ; chaque transition de phase a un critère vérifiable plutôt qu'une décision informelle ; le pipeline PNL n'est jamais interrompu (il continue de recevoir des données de l'ancien Nextor jusqu'à ce que Nextore V2 soit éprouvé).

**Négatif / dette assumée :** ce lot ne livre pas de runbook opérateur pour le personnel (procédure de bascule manuelle vers l'ancien poste en cas de panne) — à rédiger avec l'utilisateur avant d'entrer en Phase 3, hors scope technique. L'adaptation du pipeline PNL pour consommer Nextore V2 nativement (Phase 4) n'est pas conçue en détail ici — dépend de choix qui ne peuvent être faits qu'après usage réel en Phase 2-3 (CDC §0.2 : le CDC est volontairement adaptable, ne pas figer une conception avant d'avoir des données d'usage réelles).
