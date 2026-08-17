# ADR 0032 — Script d'import initial Doinsport (clients + réservations)

## Statut
Accepté

## Date
2026-08-17

## Contexte

ADR-0031 pose le modèle de données pour l'import Doinsport, en excluant explicitement le script d'import lui-même. Ce ADR couvre ce script : peupler `LegacyClient`/`LegacyBooking` une première fois depuis l'API réelle, rejouable manuellement en attendant un vrai scheduler (toujours pas de pg-boss).

## Décision

### 1. `listClients()` faisait déjà l'essentiel — juste jamais appelé

`LegacyDoinsportAdapter.listClients()` upserte déjà chaque client récupéré dans `LegacyClient` (Lot 2). Le script d'import pour les clients se limite donc à : appeler `listClients()`, puis lancer une passe de déduplication CDC §7.5 sur les clients encore `LEGACY_ONLY`. Pas de nouvelle logique de fetch/persist à écrire — seulement le fil qui relie ce qui existait déjà à quelque chose qui l'appelle réellement.

### 2. Bug réel trouvé et corrigé : pagination basée sur un `totalItems` absent

En testant l'import en conditions réelles, `listClients()` ne remontait que 200 clients. Investigation : `/clubs/clients` renvoie parfois un tableau JSON brut, sans `totalItems`/`hydra:totalItems`. La boucle de pagination existante retombait alors sur `total = batch.length` (200, la taille d'une page pleine), donc `all.length >= total` devenait vrai après la toute première page — l'import s'arrêtait silencieusement en ayant perdu 82 % des clients réels du club (1090 au total, vérifié après correction). Corrigé dans `listClients()` **et** `listBookings()` (même motif) : la pagination s'arrête désormais quand une page renvoie moins d'éléments que `perPage`, jamais en se fiant à un champ de total — cohérent avec la défiance déjà actée ailleurs dans ce même fichier (CDC §13.3 : *"le filtre temporel du listing est peu fiable, on le réapplique donc localement"*). Un bug préexistant depuis le Lot 2, jamais détecté faute d'avoir jamais fait tourner l'import à l'échelle réelle avant ce lot.

### 3. Extension du DTO : `bookingOwnerClientId`, résolu depuis `raw.participants`

Vérifié en direct sur un vrai payload `GET /clubs/bookings/:id` : le propriétaire d'une réservation est le participant avec `bookingOwner: true`, et son identifiant se trouve dans `participant.client.id` — à ne pas confondre avec `participant.user.id`, qui référence le membre du staff ayant créé la réservation (même valeur pour tous les participants d'une réservation créée par le même employé, une source de bug si confondu). Extraction ajoutée dans `normalizeBooking()` (le seul endroit autorisé à connaître la forme brute Doinsport, CDC §12.1) plutôt que dans le script d'import.

### 4. Résolution défensive : `legacyClientId` seulement si le client est déjà connu localement

Un `bookingOwnerClientId` extrait n'est écrit dans `LegacyBooking.legacyClientId` que s'il correspond à un `LegacyClient.externalId` déjà présent en base (chargés en un `Set` avant la boucle, une seule requête). Sinon, mis à `null` plutôt que d'échouer sur la contrainte de clé étrangère. D'où la recommandation d'usage : importer les clients avant les réservations (le mode `--target=all` le fait dans cet ordre automatiquement).

### 5. CLI à plat, pas de framework

`--target=clients|bookings|all`, `--from=`/`--to=` (défaut : 2 ans en arrière → 1 an en avant, toujours affiché en clair dans la sortie plutôt que silencieux). Parsing manuel de `process.argv`, cohérent avec le reste du projet qui n'a jamais introduit de dépendance CLI (`commander`, `yargs`, etc.) pour ses scripts (`prisma/seed.ts` fait de même).

### 6. Idempotent par construction, pas par précaution ajoutée

Le script peut être rejoué sans effet de bord grâce aux contraintes déjà posées en ADR-0031 (`externalId` unique sur `LegacyClient`, `(externalId, courtId)` unique sur `LegacyBooking`) — chaque étape est un upsert. Aucune logique de "ne pas réimporter ce qui existe déjà" à écrire séparément.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Réessayer avec `hydra:totalItems` dans un format différent avant d'abandonner le comptage par total | L'API renvoie parfois un tableau JSON brut sans aucun wrapper — aucun champ de total n'existe alors, quel que soit le nom cherché. La pagination par taille de page fonctionne dans tous les cas observés, avec ou sans wrapper |
| Extraire `bookingOwnerClientId` dans le script d'import en lisant `raw` directement | Aurait dupliqué la connaissance du format Doinsport hors de l'adapter, contrairement à la règle déjà établie CDC §12.1 |
| Échouer l'import d'une réservation si son `legacyClientId` ne correspond à aucun client connu | Une réservation reste une occupation valable pour l'anti-collision (CDC §10.3) même sans propriétaire résolu — `null` plutôt qu'un échec bloquant |

## Conséquences

**Positif :** vérifié en conditions réelles contre l'API Doinsport de production (lecture seule côté Doinsport, écritures uniquement dans la base de dev locale, nettoyée après vérification) : 1090 clients réels importés après correction du bug de pagination (contre 200 avant), 49 réservations réelles importées sur une fenêtre de test (±quelques semaines), 31/49 propriétaires correctement résolus — les 18 restantes n'ont simplement aucun participant marqué `bookingOwner: true` côté Doinsport (créneaux bloqués par le club, pas un défaut de l'import). 6 nouveaux tests unitaires sur la logique de déduplication pure (`client-dedup.ts`). 232 tests au total, 38 fichiers verts.

**Négatif / dette assumée :** toujours pas de scheduler récurrent (ce script reste à lancer manuellement) ; pas d'écran admin pour suivre les exécutions (`LegacySyncRun` existe, rien ne l'affiche) ni pour revoir les `MERGE_REQUIRED` ; le calcul de disponibilité (`AvailabilityRepository.findOccupyingBookings`) n'utilise toujours pas `LegacyBooking` — l'anti-collision CDC §10.3 reste à brancher.
