# Stratégie de migration — Dual Run et cohortes

Référence normative : CDC sections 2.2, 7.3–7.5, 15, 48–52, Annexes B et C.

## Principe

Pas de Big Bang. Doinsport et V2 fonctionnent simultanément ; les utilisateurs Legacy continuent de réserver via Doinsport pendant que les utilisateurs migrés utilisent V2. Doinsport reste l'autorité anti-collision commune jusqu'au cutover.

## Migration des identités

Il n'existe pas d'endpoint d'authentification joueur Doinsport confirmé (uniquement un login club). Stratégie retenue :

1. synchroniser les fiches clients Doinsport → `ShadowClient` local ;
2. envoyer une invitation de migration par e-mail ;
3. lien unique à durée limitée → possession du lien = e-mail vérifié ;
4. le joueur choisit son mot de passe V2 ;
5. `ShadowClient` lié au nouvel utilisateur, `legacy_client_id` conservé.

États : `LEGACY_ONLY → INVITED → MIGRATION_PENDING → MIGRATED` (+ `DISABLED`, `MERGE_REQUIRED` en cas de conflit).

Le paiement d'une invitation à une réservation SPLIT est un vecteur naturel de migration (CDC §75).

## Phases (CDC §50)

| Phase | Contenu | Sortie |
|---|---|---|
| 0 — Développement | V2 non exposée, Stripe test, Doinsport test contrôlé | Suite de tests verte, staging fonctionnel |
| 1 — Interne | Comptes staff, réservations test, parcours complet | Aucune anomalie critique sur parcours complet, [`docs/annexe-b-checklist.md`](annexe-b-checklist.md) majoritairement verte |
| 2 — Pilote | Groupe réduit de joueurs réguliers invités | Cutover checklist partielle validée sur volume pilote |
| 3 — Extension | Cohortes progressives, monitoring quotidien | Taux d'erreur acceptable maintenu à volume croissant |
| 4 — Généralisation | Tous les nouveaux utilisateurs sur V2, campagne de migration | Majorité du volume actif sur V2 |
| 5 — Cutover | V2 source de vérité, Doinsport read-only | Annexe C entièrement cochée |
| 6 — Extinction | Export historique, vérifications finales, arrêt Doinsport | `LEGACY_MODE=disabled` |

## Staging

Artefacts posés (ADR-0037, `docs/deployment.md`) : Dockerfiles API/web, `docker-compose.staging.yml`, reverse proxy Caddy (TLS automatique). Reste à provisionner : un serveur réel et un domaine (décision opérationnelle du club).

## Suivi Annexe B

[`docs/annexe-b-checklist.md`](annexe-b-checklist.md) trace item par item les 44 points de l'Annexe B du CDC — statut réel (vérifié en conditions réelles / codé mais non exercé avec de vraies données externes / dette connue / bloqué), preuve associée, et identifie précisément ce qui bloque concrètement le passage à la Phase 1 (au 2026-08-17 : absence d'environnement de staging réel, et compte Stripe).

## Ne jamais couper Doinsport "parce que ça semble marcher"

Le cutover est gouverné par la checklist explicite du CDC §51 et l'Annexe C — pas par une impression de stabilité. Définir un volume pilote et une période sans incident critique avant de passer à la phase suivante.

## Rollback

Le Dual Run rend le rollback possible à tout moment avant cutover : redirection temporaire vers Doinsport, aucune suppression de donnée V2, paiements V2 restent gérés par V2.
