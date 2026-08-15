# Revue de sécurité

CDC §59, §101. Revue de code auto-administrée (Lot 10, 2026-08-14) — **pas un audit de sécurité externe**. Chaque ligne référence le fichier qui l'implémente, pour qu'un futur audit puisse vérifier directement plutôt que de faire confiance à cette liste.

## §59.1 — Auth

| Exigence | Statut | Détail |
|---|---|---|
| Cookies sécurisés HttpOnly | ✅ Fait | [`session-cookie.ts`](../apps/api/src/modules/identity/session-cookie.ts) — `httpOnly: true`, `secure: NODE_ENV === "production"` |
| SameSite adapté | ✅ Fait | `sameSite: "lax"` — protection CSRF de base pour une architecture même-origine (voir §59.2 CSRF ci-dessous) |
| Rotation session | ✅ Fait | Un nouveau token est émis à chaque login ; `logout-all` révoque toutes les sessions actives (`identity.service.ts`) |
| Limite tentatives login | ✅ Fait | `LOGIN_MAX_FAILED_ATTEMPTS`/`LOGIN_FAILED_ATTEMPTS_WINDOW_MINUTES` (par compte, Lot 1) + `RATE_LIMIT_AUTH_MAX_REQUESTS` (par IP sur `/auth/*`, Lot 10) — deux mécanismes complémentaires |
| Reset token court et usage unique | ✅ Fait | `PASSWORD_RESET_TOKEN_TTL_MINUTES`, token opaque hashé, consommé une fois (`identity.service.ts`) |
| Validation e-mail | ✅ Fait | Compte `PENDING_VERIFICATION` jusqu'à vérification (Lot 1) |

## §59.2 — API

| Exigence | Statut | Détail |
|---|---|---|
| Validation stricte des payloads | ✅ Fait | Schémas Zod sur chaque endpoint d'écriture, partout depuis le Lot 1 |
| RBAC | ✅ Fait | `requireRole` à 4 niveaux (CUSTOMER/STAFF/ADMIN/SUPER_ADMIN), systématique sur les routes admin (Lots 7-10) |
| CSRF | ⚠️ Mitigé, pas de token dédié | `SameSite=lax` empêche l'envoi du cookie de session sur une requête cross-site déclenchée par un tiers (formulaire, image) pour les méthodes qui comptent. Un token CSRF explicite n'est pas implémenté — acceptable pour une architecture même-origine (API + futur frontend sur le même domaine public), à revalider si un client tiers cross-origin apparaît |
| CORS limité | ✅ Fait (Lot 10) | `CORS_ALLOWED_ORIGINS` (liste blanche explicite, défaut = `PUBLIC_BASE_URL` seul) — jamais de `*` — [`app.ts`](../apps/api/src/app.ts) |
| Rate limiting raisonnable | ✅ Fait (Lot 10) | `express-rate-limit` global (`RATE_LIMIT_MAX_REQUESTS`/`RATE_LIMIT_WINDOW_MINUTES`) + limite dédiée plus stricte sur `/auth/*` |
| Security headers | ✅ Fait (Lot 10) | `helmet()` — CSP par défaut, `X-Content-Type-Options`, etc. |
| Aucune stacktrace brute côté client | ✅ Fait | [`error-handler.ts`](../apps/api/src/http/error-handler.ts) — toute erreur non anticipée devient un message générique 500, jamais la stack (en place depuis le Lot 1) |
| Endpoints Terminal ConnectionToken strictement authentifiés | ✅ Fait | `requireKioskAuth` sur `/terminal/*` (Lot 7) |
| QR tokens opaques, courts, hashés en base | ✅ Fait | `KioskCheckoutSession.tokenHash`, jamais le token brut stocké (Lot 7) |
| Dispositifs kiosque enregistrés et révocables | ⚠️ Partiel | `KioskDeviceService.revoke()` existe (Lot 7) mais **aucune route ne l'expose** — gap identifié au Lot 9 (ADR-0017), non comblé. Un admin ne peut révoquer un kiosque qu'en écrivant du code, pas via l'API |

## §59.3 — Secrets

| Exigence | Statut | Détail |
|---|---|---|
| `.env` gitignored | ✅ Fait | Vérifié — seul `.env.example` (sans valeurs réelles) est versionné |
| Aucun secret dans les fixtures | ✅ Fait | Les seeds utilisent des mots de passe de développement documentés comme tels (`DevPassword123!`), jamais un secret réel |
| Rotation possible | ✅ Fait | Tous les secrets sont des variables d'environnement, aucun hardcodé — rotation = redéploiement avec nouvelles valeurs |
| Clés différentes test/prod | ⚠️ Non vérifiable à ce stade | Aucun compte Stripe ni environnement de production n'existe encore pour Ardenne Padel (ADR-0010) — à valider au moment du provisionnement réel |

## §59.4 — Doinsport

| Exigence | Statut | Détail |
|---|---|---|
| Compte club à privilèges minimaux | ⚠️ Hors contrôle du code | Dépend des permissions accordées au compte `DOINSPORT_CLUB_LOGIN` côté Doinsport — décision opérationnelle, pas applicative |
| JWT en mémoire/cache sécurisé | ✅ Fait | `LegacyAuthToken` en base (jamais loggé, CDC §57.1), courte durée de vie (~1h) — voir ADR-0005 |
| Aucun endpoint Legacy accessible depuis le navigateur | ✅ Fait | `LegacyDoinsportAdapter`/`LegacyDoinsportRepository` ne sont jamais exposés par une route publique — toute donnée Legacy transite par les routes V2 |
| Toutes les requêtes Doinsport passent par le backend | ✅ Fait | Aucune clé/JWT Doinsport n'est jamais envoyée au client |

## Synthèse

**16 exigences sur 20 pleinement satisfaites.** 4 partielles/hors contrôle :
1. CSRF — mitigation SameSite jugée suffisante pour l'architecture actuelle, pas un token dédié.
2. Révocation kiosque — service existant, route manquante (gap Lot 7/9).
3. Clés test/prod distinctes — non vérifiable sans compte Stripe réel.
4. Privilèges du compte Doinsport — décision opérationnelle externe au code.

Aucune de ces quatre lacunes n'est bloquante pour continuer le développement ; toutes doivent être revues avant un pilote avec de vrais utilisateurs (Annexe B : "Security review").
