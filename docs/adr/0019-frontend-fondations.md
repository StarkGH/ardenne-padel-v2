# ADR 0019 — Fondations frontend Next.js (parcours FULL online)

## Statut
Accepté

## Date
2026-08-15

## Contexte

Après 10 lots exclusivement backend, aucun frontend n'existait dans ce projet — chaque ADR précédente (0014, 0016, 0017, 0018) documentait ce manque comme une limite de scope assumée. Le CDC §53/§54 décrit une PWA React/Next.js mobile-first avec 23 écrans client (+ 8 écrans kiosque, + 25 écrans admin). Construire l'intégralité en une session est déraisonnable — ce lot livre les fondations et le parcours critique le plus simple (E2E-001 : utilisateur neuf → simple/double → créneau → inscription → FULL online → confirmation), sur le même principe de scoping progressif que chaque lot backend (Lot 3 : cœur de réservation avant SPLIT/wallet/kiosque).

## Décision

### 1. `apps/web`, Next.js App Router, aucun état serveur pour l'auth dans ce lot

Scaffoldé via `create-next-app` (TypeScript, Tailwind, App Router, `src/`) — conforme à la structure de repository déjà annoncée dans le README depuis le Lot 0 (`/web` PWA React/Next.js). Port 3001, cohérent avec `PUBLIC_BASE_URL`/`WEB_PORT` déjà présents dans `.env.example` depuis le Lot 0 (jamais utilisés jusqu'ici). L'état d'authentification est géré **côté client uniquement** (`SessionProvider`, `GET /auth/me` au montage) plutôt que par un relais du cookie de session dans les Server Components — plus simple et plus sûr pour un premier lot, documenté comme piste d'amélioration plutôt que traité comme un défaut caché.

### 2. Le frontend ne contient aucune décision métier — juste de l'orchestration d'appels

CDC §129 : "le frontend ne doit pas contenir de logique métier critique". `src/lib/api.ts` ne fait que traduire requête/réponse (jamais de calcul de prix, de règle de disponibilité, ou de validation métier dupliquée côté client) — chaque page appelle l'API réelle et affiche son résultat tel quel. Le calcul du prix (`/pricing/quote`), la disponibilité (`/availability`), la création de réservation (`POST /bookings`) restent entièrement portés par le backend.

### 3. Session cookie partagée entre les ports 3000/3001 sans configuration supplémentaire

Le cookie de session (`SameSite=Lax`, sans `Domain` explicite) est scopé à l'hôte `localhost` — les ports n'entrent pas dans le calcul de "site" pour `SameSite`, donc un `fetch` avec `credentials: "include"` depuis `localhost:3001` vers `localhost:3000` envoie le cookie normalement, à condition que CORS l'autorise. `CORS_ALLOWED_ORIGINS` (Lot 10) défaut à `PUBLIC_BASE_URL` = `http://localhost:3001` — déjà correctement aligné sans aucune modification backend nécessaire pour ce lot.

### 4. Reprise de sélection après authentification via `sessionStorage`, pas une route serveur

CDC §53 : "reprise après retour d'authentification". Le brouillon de réservation (terrain, date, heure, durée) est persisté dans `sessionStorage` à chaque changement et restauré au montage de `/book` — survit à la navigation complète vers `/login` et retour. **Un vrai bug a été trouvé et corrigé en testant ce parcours en direct dans le navigateur** : l'effet qui recharge les disponibilités à chaque changement de terrain/date réinitialisait systématiquement le créneau choisi (`setStartTime(null)`) avant même de savoir si le nouveau chargement le concernait — ce qui effaçait silencieusement le créneau restauré depuis `sessionStorage` juste après l'avoir restauré. Corrigé en ne réinitialisant le créneau que s'il n'apparaît plus dans la liste fraîchement chargée, plutôt que de l'effacer inconditionnellement.

### 5. Paiement : le parcours complet est câblé, la collecte de carte ne l'est pas

Sans compte Stripe (ADR-0010), aucune intégration Stripe Elements/Stripe.js réelle n'est possible. La page `/checkout/[bookingId]` appelle `POST /payments/checkout` avec un `paymentMethodId` de test — exactement comme les tests backend depuis le Lot 4 — et affiche la dégradation `503 STRIPE_NOT_CONFIGURED` de façon lisible plutôt que de bloquer le parcours. Le jour où une clé Stripe existera, seul le bouton "Payer" doit être remplacé par un vrai `PaymentElement` Stripe.js ; le reste du parcours (récapitulatif, appel API, gestion de la réponse) fonctionne déjà.

### 6. Icônes PWA en SVG, pas en PNG

Le manifest référence `icon.svg` (`image/svg+xml`) plutôt que des PNG multi-résolutions générés. Largement supporté (Chrome/Edge), documenté comme simplification à corriger avant un vrai déploiement (icônes PNG 192/512 + `maskable` dédiées) plutôt que fabriqué avec un outil de génération d'image non disponible dans cet environnement.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Server Components avec relais du cookie de session | Plus correct à terme (rendu serveur du contenu authentifié, meilleur SEO/perf) mais plus complexe à mettre en place correctement dans un premier lot ; l'approche client-only reste un standard valide pour une PWA et n'empêche pas une migration progressive |
| Bibliothèque de data-fetching (TanStack Query, SWR) | Dépendance supplémentaire non nécessaire pour la taille actuelle de l'app ; `fetch` direct dans `useEffect` suffit et reste cohérent avec la philosophie de dépendances minimales du reste du projet |
| Construire aussi le parcours SPLIT/wallet/kiosque dans ce même lot | Aurait dilué la vérification en direct sur un scope trop large ; le parcours FULL online est le plus simple et le plus représentatif (E2E-001), les autres parcours suivront lot par lot comme côté backend |
| Générer de vraies icônes PNG via un outil externe | Aucun outil de rendu d'image disponible dans cet environnement ; le SVG couvre l'essentiel de l'exigence "installable" pour les navigateurs majeurs |

## Conséquences

**Positif :** parcours complet vérifié en direct dans un vrai navigateur (accueil → choix terrain → calendrier → créneau → durée → récapitulatif avec prix réel → connexion avec reprise de sélection → création de réservation → paiement avec dégradation propre → liste "mes réservations" → détail). Un vrai bug de persistance de sélection trouvé et corrigé pendant cette vérification, pas après coup. Build et lint propres.

**Négatif / dette assumée :** 3 des 23 écrans client MVP construits en profondeur (accueil, réservation FULL, mes réservations/détail/annulation) plus auth (inscription/connexion/vérification) ; SPLIT, wallet, profil, gestion des moyens de paiement, kiosque et les 25 écrans admin restent à construire lot par lot. Pas de rendu serveur de l'état authentifié. Icônes PWA en SVG uniquement. Aucune intégration Stripe Elements réelle (attend un compte Stripe, comme tout le reste du projet). Vérification manuelle uniquement via l'arbre d'accessibilité et le texte de page (l'outil de capture d'écran n'était pas disponible dans cet environnement) — pas de vérification visuelle pixel par pixel.
