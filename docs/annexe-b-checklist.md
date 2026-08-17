# Suivi Annexe B — Checklist pré-pilote

Traçabilité CDC Annexe B (44 items) — mise à jour au fil des lots plutôt qu'en fin de projet, pour que "on est prêt pour le pilote" repose sur une preuve item par item et non sur une impression. Complète `docs/migration.md` (Phase 0 → Phase 1) : la sortie de Phase 0 exige "suite de tests verte, staging fonctionnel" — la suite de tests l'est (259 tests, 42 fichiers) ; **les artefacts de staging (Dockerfiles, orchestration, reverse proxy TLS, runbook) sont désormais posés (ADR-0037, `docs/deployment.md`) mais aucun serveur réel n'est encore provisionné** — voir "Ce qui bloque réellement" en bas de page.

Légende : ✅ codé et vérifié en conditions réelles · 🟡 codé, testé, non vérifié avec de vraies données/clés externes · ⚠️ partiel/dette connue · ❌ non fait/hors de portée sans prérequis externe.

## Identité et migration

| Item | Statut | Preuve |
|---|---|---|
| Auth locale fonctionnelle | ✅ | `identity.integration.test.ts` (register → verify → login → me → logout), vérifié en direct à plusieurs reprises |
| Migration Legacy par invitation fonctionnelle | ✅ | ADR-0036 — vérifié en direct de bout en bout (invitation → lien → mot de passe → compte `ACTIVE` → connexion) le 2026-08-17 |
| Shadow clients synchronisés | ✅ | ADR-0031/0032/0035 — 1090 clients réels importés et resynchronisés automatiquement (scheduler 60s/300s) contre l'API Doinsport réelle |

## Terrains et tarifs

| Item | Statut | Preuve |
|---|---|---|
| Terrains configurés | ⚠️ | Seuls les 4 terrains de démonstration du seed (Padel 1-4) existent — configuration des vrais terrains du club non faite (donnée opérationnelle, pas un gap de code) |
| Tarifs V2 validés | ⚠️ | Tarifs de démonstration seedés uniquement — grille tarifaire réelle jamais soumise ni validée par le club |
| Prix comparés Legacy/V2 | ✅ | `LEGACY_PRICE_MISMATCH_TOLERANCE_CENTS` (`legacy-booking-sync.ts`) — alerte sur écart suspect, jamais de correction silencieuse (CDC §11.3) |

## Disponibilité et anti-collision

| Item | Statut | Preuve |
|---|---|---|
| Availability testée | ✅ | `slot-calculator.test.ts`, `availability.service.test.ts`, anti-collision Dual Run vérifiée en direct (ADR-0033, y compris conversion fuseau horaire) |
| Create Legacy 201 | ✅ | `bookings.service.ts` + `legacy-doinsport.adapter.ts`, testé (création réelle vérifiée en direct au Lot 1 frontend) |
| Collision Legacy 422 | ✅ | Traitée comme collision finale (CDC §15.4), testée dans le parcours checkout |
| Cancel Legacy validé | ✅ | Annulation testée, y compris `withRefund` |
| `withRefund:false` validé | ✅ | Câblé dans `bookings.service.ts`/`bookings-admin.service.ts` |
| Correlation marker validé | ✅ | `APV2:<booking_uuid>` (CDC §16.1), ADR-0006 |
| Timeout/reconciliation validé | ✅ | `LEGACY_CONFIRMATION_UNKNOWN` (CDC §16.2), testé |

## Paiements

| Item | Statut | Preuve |
|---|---|---|
| Stripe test complet | ❌ | Bloqué — aucun compte Stripe réel pour Ardenne Padel (V-011 à V-017) |
| Webhooks idempotents | 🟡 | `webhook.routes.ts` + tests de résilience — jamais exercé avec de vrais webhooks Stripe |
| Paiement partagé (SPLIT) | 🟡 | Flux complet testé et vérifié en direct jusqu'à la limite imposée par l'absence de Stripe (ADR-0020) |
| Régularisation (garantie organisateur) | 🟡 | `booking-guarantee.service.ts` codé et testé — vérifié en direct côté wallet uniquement, côté carte bloqué par Stripe |
| Wallet ledger | ✅ | Testé extensivement, **paiement 100 % wallet réellement abouti en direct** (Frontend Lot 3) |
| Packs de crédits | 🟡 | Testé, dégradation `STRIPE_NOT_CONFIGURED` propre — achat réel non vérifiable sans Stripe |
| Bonus crédits | ✅ | Testé (composition payé/bonus/offert affichée et vérifiée en direct) |
| Wallet holds | ✅ | Testé (création/capture/libération), vérifié en direct (Frontend Lot 7) |
| Paiement FULL online | 🟡 | Dégradation propre sans Stripe, jamais exercé avec une vraie carte |
| Paiement FULL Terminal | ❌ | `StripeTerminalProvider` posé et testé unitairement mais **non câblé** dans un flux de réservation réel (V-014) |
| QR handoff | ✅ | Vérifié en direct de bout en bout, deux onglets simulant tablette + téléphone (Frontend Lot 5) |
| Paiement mixte wallet + externe | 🟡 | Codé et vérifié pour la part wallet ; la part externe reste bloquée par Stripe |
| SPLIT service fee | ✅ | Testé (ADR-0013) |
| Garantie carte off-session | ❌ | Bloqué par Stripe — nécessite une vraie carte enregistrée |
| Garantie wallet | ✅ | Testé et vérifié en direct |
| Frais provider réels reportés | 🟡 | Modélisé (`stripe-payment-provider.ts`), jamais alimenté par de vrais frais Stripe |
| Validation comptable/TVA crédits | ⚠️ | V-018 partiellement clos — réservations + wallet à 6 % confirmés par le comptable (BDO, `docs/tva.md`), licence AFP et taux boissons encore en attente côté comptable |
| Validation juridique frais SPLIT | ❌ | Ouvert (V-019) — wording à faire valider pour ne jamais être requalifié en surcharge carte interdite en Belgique |
| Annulation/remboursement | ✅ | `RefundService` testé, dégradation Stripe propre vérifiée en direct |

## Accès, notifications, admin

| Item | Statut | Preuve |
|---|---|---|
| Notifications | ✅ | `NotificationService` + outbox testés (Lot 8) |
| Access V2 | ✅ | `AccessGrantService` testé, vérifié en direct (écran Accès) |
| Access Legacy | 🟡 | Codé et testé, désactivé par défaut (`LEGACY_ACCESS_IMPORT_ENABLED=false`) en attendant validation opérationnelle |
| Dashboard admin | ✅ | Vérifié en direct (indicateurs, alertes réelles) |
| Manual review | ✅ | Écran Incidents, vérifié en direct |
| Audit log | ✅ | Vérifié en direct, filtrable |

## Exploitation

| Item | Statut | Preuve |
|---|---|---|
| Backup | ⚠️ | Mécanisme (`pg_dump -Fc`) testé manuellement (`docs/backup-restore.md`) — **aucune sauvegarde automatique récurrente configurée** |
| Restore | 🟡 | Restauration réelle testée avec succès (Lot 10) sur un volume de développement — jamais rejouée à volume de production |
| Monitoring | ⚠️ | `HealthIndicatorsService`/`AlertsService` exposent des indicateurs dans le dashboard admin (vérifié en direct) — aucun système d'alerte externe (paging/e-mail ops) |
| Security review | ⚠️ | Revue auto-administrée complète (`docs/security.md`, 16/20 exigences pleinement satisfaites) — **pas un audit externe** |
| E2E Playwright | ❌ | Non fait — la vérification "en direct" de ce projet s'est faite manuellement via navigateur à chaque lot, jamais automatisée en E2E |
| Pilot feature flag | ✅ | `pilotUser`/`PILOT_MODE_ENABLED` — cohorte pilote restreinte, bascule vérifiée en direct (Frontend Lot 6) |

## Synthèse

**24 ✅ pleinement vérifiés · 9 🟡 codés et testés, non vérifiés en conditions externes réelles · 6 ⚠️ dette opérationnelle connue et documentée · 5 ❌ bloqués ou non faits** (sur 44).

## Ce qui bloque réellement la Phase 1 (interne)

Contrairement à l'impression que pourrait donner le total ci-dessus, la Phase 1 ("comptes staff, réservations test, parcours complet") ne nécessite **pas** que les 44 items soient verts — elle nécessite un environnement où les exercer. Deux prérequis concrets, ni l'un ni l'autre du code applicatif :

1. **Un serveur réel pour l'environnement de staging.** Les artefacts existent désormais (ADR-0037) : `apps/api/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.staging.yml`, reverse proxy Caddy avec TLS automatique, runbook complet (`docs/deployment.md`). **Un bug bloquant de production a été trouvé et corrigé au passage** : le build compilé (`npm run build && node dist/server.js`) ne démarrait pas du tout avant ce lot (résolution de module cassée pour les packages partagés) — jamais détecté car aucun lot précédent n'avait exécuté ce chemin de bout en bout. Ce qui manque encore : un serveur (VPS ou équivalent) réellement provisionné et un domaine pointant dessus — décision opérationnelle (fournisseur, coût) hors du périmètre du code — et une vérification des Dockerfiles par un vrai `docker build` (non exécutable dans l'environnement de développement utilisé pour ce lot, accès `sudo` indisponible pour démarrer le démon Docker).
2. **Un compte Stripe réel** (test puis live) — bloque à lui seul 7 des 9 items 🟡 ci-dessus (webhooks, paiement partagé, régularisation carte, packs de crédits, paiement FULL online, part externe du paiement mixte, frais provider), plus 3 des ❌ (Stripe test complet, Terminal, garantie carte) — tous déjà codés et testés unitairement mais jamais exercés avec de vraies clés.

Les deux 🟡 restants (Access Legacy, Restore à volume production) et les gaps ⚠️ (terrains/tarifs réels, sauvegardes automatiques, monitoring externe, audit de sécurité externe, wording juridique SPLIT) sont réels mais n'empêchent pas de démarrer une Phase 1 restreinte à l'équipe — ils redeviennent bloquants à mesure qu'on avance vers la Phase 2 (pilote) puis le cutover (Annexe C).
