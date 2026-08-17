# ADR 0035 — Scheduler récurrent de synchro Doinsport → V2

## Statut
Accepté

## Date
2026-08-17

## Contexte

Le modèle de données (ADR-0031), le script d'import initial (ADR-0032), l'anti-collision Dual Run (ADR-0033) et l'écran de revue des conflits (ADR-0034) posaient tous la même limite : `LegacyBooking`/`LegacyClient` n'étaient à jour qu'au rythme du dernier lancement manuel de `npm run import:legacy`. Le CDC §15 ("Synchronisation Doinsport → V2") exige un polling automatique, à deux niveaux distincts (§15.3) :

- **Sync fréquente** — réservations proches, intervalle court (recommandation CDC : 60 s, "ne pas descendre agressivement sans connaître les rate limits").
- **Réconciliation complète** — comparaison plus large, intervalle "typiquement plusieurs minutes".

`LEGACY_SYNC_ENABLED`, `LEGACY_SYNC_INTERVAL_SECONDS` (60) et `LEGACY_RECONCILIATION_INTERVAL_SECONDS` (300) existaient déjà en configuration depuis le Lot 0 — jamais lus jusqu'à ce lot (confirmé par une recherche dans le code avant de commencer).

## Décision

### Extraction de la logique d'import dans un module partagé, pas de duplication

`importClients`/`importBookings` (`legacy-import.service.ts`, nouveau) sont extraites telles quelles du script CLI (`scripts/import-legacy.ts`) — même comportement (upsert idempotent, traçage `LegacySyncRun`, déduplication CDC §7.5), consommées à la fois par le script manuel et par le scheduler. Signature changée pour prendre l'interface `LegacyBookingProvider` plutôt que la classe concrète `LegacyDoinsportAdapter`, seul changement fonctionnel de cette extraction — nécessaire pour rester testable avec `FakeLegacyProvider` (déjà utilisé ailleurs dans la suite de tests) sans appel réseau réel.

### `LegacySyncScheduler` : deux minuteurs indépendants, fenêtres différentes de l'import initial

- **`runFastSync`** — réservations uniquement, fenêtre glissante courte (`maintenant - 1h` → `maintenant + 30 jours`). C'est ce qui alimente l'anti-collision Dual Run (ADR-0033) en quasi temps réel : seul l'avenir proche importe pour éviter une double réservation.
- **`runReconciliation`** — clients (import complet, comme le script manuel) + réservations sur une fenêtre plus large mais toujours future (`maintenant - 1 jour` → `maintenant + 1 an`).

Contrairement à l'import initial (`import-legacy.ts`, qui remonte 2 ans en arrière pour constituer l'historique une bonne fois), aucun des deux cycles récurrents ne rebalaie le passé : une fois l'historique importé, seules les réservations futures affectent l'anti-collision ou la déduplication client. Rebalayer 2 ans à chaque cycle de réconciliation (toutes les 5 minutes par défaut) aurait été un coût réseau et de calcul sans aucun bénéfice fonctionnel.

### Garde anti-chevauchement, pas de file d'attente

Chaque cycle (`fastRunning`/`reconciliationRunning`, deux booléens simples) ignore silencieusement — avec un log `LegacySyncSkippedOverlap` — tout déclenchement pendant qu'une exécution précédente du même type est encore en cours. Pas de file d'attente ni de retry différé : un cycle sauté sera simplement rattrapé au suivant, l'intervalle configuré agissant déjà comme un throttle naturel. Complexité d'une vraie infrastructure de job (pg-boss) délibérément évitée pour ce besoin — cohérent avec la dette déjà documentée ailleurs dans le projet (`notification.service.ts`, `webhook.routes.ts`).

### Démarré depuis `server.ts`, jamais depuis `app.ts`

`app.ts` est partagé avec le harnais de test (`supertest`, `createApp()` instancié dans chaque fichier de test d'intégration) — y démarrer le scheduler aurait fait tourner de vrais appels réseau vers Doinsport en arrière-plan pendant toute la suite de tests. Le scheduler est construit et démarré uniquement dans `server.ts` (le point d'entrée du process réel), arrêté proprement dans le handler `shutdown` existant (`SIGINT`/`SIGTERM`).

### Démarrage défensif : jamais de crash si mal configuré

`start()` ne fait rien (avec un log explicite) si `LEGACY_SYNC_ENABLED=false` ou si les identifiants Doinsport (`DOINSPORT_CLUB_LOGIN`/`_PASSWORD`/`_ID`) sont absents — plutôt que de laisser le premier cycle échouer avec une erreur d'authentification peu claire une minute après le démarrage. Utile pour tout environnement (staging, CI d'un futur environnement de démo) où ces identifiants ne sont pas encore provisionnés.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Un seul minuteur combinant clients + réservations à chaque cycle | Contredit explicitement le CDC §15.3, qui distingue les deux besoins avec des cadences différentes ; aurait aussi rendu la sync fréquente inutilement coûteuse (le rapatriement des ~1090 clients n'a pas besoin d'être refait toutes les 60 secondes) |
| File d'attente/retry si un cycle est sauté par chevauchement | Complexité disproportionnée pour un throttle déjà assuré par l'intervalle suivant — un cycle sauté est rattrapé automatiquement au prochain tick |
| pg-boss ou autre infra de job durable | Toujours pas introduite dans le projet (dette déjà documentée) ; `setInterval` en mémoire suffit pour un seul process API, pas de besoin de distribution multi-instance à ce stade |

## Conséquences

**Positif :** vérifié en conditions réelles de bout en bout — serveur démarré avec les vraies clés Doinsport (`apps/api/.env`), log `LegacySyncSchedulerStarted` confirmé, puis exactement 60 secondes plus tard un vrai cycle de sync fréquente a interrogé l'API Doinsport réelle et listé 49 réservations (cohérent avec les imports manuels précédents du Lot 11), `LegacySyncRun` correctement tracé en base (`SUCCESS`, 49/49). Données réelles nettoyées de la base de dev après vérification. 5 nouveaux tests (garde anti-chevauchement, création des runs par type, démarrage défensif si désactivé/identifiants absents), 250 au total, 41 fichiers verts.

**Négatif / dette assumée :** un seul process API ⇒ un seul scheduler ; si l'API est un jour déployée en plusieurs instances, les deux minuteurs tourneraient en double (chaque instance déclenchant ses propres cycles) — pas un problème aujourd'hui vu l'architecture mono-instance du projet, mais à surveiller si ça change. Pas de rattrapage explicite si le process reste éteint plus longtemps qu'un cycle de réconciliation (ex. redéploiement) — le prochain démarrage rattrape simplement au cycle suivant, sans écart signalé. Le script d'import manuel (`import-legacy.ts`) reste nécessaire pour tout import ponctuel hors fenêtre (rattraper un historique antérieur à ce que couvre la réconciliation) ou en environnement où `LEGACY_SYNC_ENABLED=false`.
