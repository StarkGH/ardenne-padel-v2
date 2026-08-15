# Backup & Restore

CDC §61, §101. Statut : **restauration testée réellement** (Lot 10, 2026-08-14) — voir résultat du run ci-dessous.

## Stratégie actuelle (dev/staging)

PostgreSQL natif, `pg_dump`/`pg_restore` au format custom (`-Fc`) — compressé, restaurable sélectivement table par table si besoin, contrairement à un dump SQL brut.

```bash
# Sauvegarde
pg_dump -h <host> -p <port> -U <user> -Fc -f ardenne_padel_v2_$(date +%Y%m%d_%H%M%S).dump ardenne_padel_v2

# Restauration (base vide, préalablement créée)
pg_restore -h <host> -p <port> -U <user> -d <base_cible> --no-owner <fichier.dump>
```

## Résultat du test de restauration réel (Lot 10)

Exécuté contre la base de développement (`ardenne_padel_v2`, PostgreSQL 14.22, WSL) :

1. `pg_dump -Fc` de la base seedée (2 users, 4 courts, 8 tariff_rules, 2 credit_packs, plus tout le schéma des 33 tables du projet) — **1s**, taille du dump **92 Ko**.
2. Création d'une base vide dédiée (`ardenne_padel_v2_restore_drill`).
3. `pg_restore --no-owner` dans cette base — **1s**.
4. Comparaison des comptages de lignes source vs restaurée sur les tables clés (`users`, `courts`, `tariff_rules`, `credit_packs`) — **identiques**.
5. Nettoyage : base de test supprimée, fichier de dump supprimé.

Sur un volume de données de développement, l'opération est quasi instantanée. Ces temps ne sont **pas représentatifs d'un volume de production** (des années de réservations, paiements, wallet_transactions) — à revalider avec un volume réaliste avant le cutover Doinsport (CDC §61 : "avant cutover, effectuer un test réel de restauration").

## RPO / RTO retenus (proposition, à valider avec le club avant pilote réel)

| | Valeur proposée | Justification |
|---|---|---|
| **RPO** (perte de données maximale tolérée) | 24h en développement / **à réduire à ≤1h avant le pilote** | Aucune sauvegarde automatique récurrente n'est encore configurée (voir "Restant" ci-dessous) — cette valeur est un objectif, pas un état actuel |
| **RTO** (temps de restauration maximal toléré) | 30 minutes | Basé sur le temps mesuré ci-dessus, avec une marge large pour un volume de production et les étapes manuelles (provisionner une base, ajuster `DATABASE_URL`, relancer l'API) |

Ces valeurs sont des **propositions à faire valider par le club** — le CDC (§61) demande de les documenter, pas de les fixer unilatéralement côté développement.

## Restant (dette assumée, à combler avant le pilote réel)

- **Sauvegardes automatiques récurrentes** : aucun cron/tâche planifiée ne déclenche de `pg_dump` aujourd'hui — ce test a été exécuté manuellement. À automatiser avant tout environnement staging/production (CDC §61 : "sauvegardes automatiques").
- **Conservation multiple** : aucune politique de rétention (ex. 7 quotidiennes + 4 hebdomadaires) n'est en place.
- **Copie hors instance principale** : le dump de ce test est resté sur la même machine que la base ; en production, la copie doit être envoyée vers un stockage distinct (objet/S3-compatible ou équivalent).
- **Volume de production** : ce test valide le *mécanisme*, pas les *temps* à l'échelle réelle — à rejouer avec un jeu de données représentatif avant le cutover.
