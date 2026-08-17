# Suivi Annexe B — Checklist pré-pilote

Traçabilité CDC Annexe B (44 items) — mise à jour au fil des lots plutôt qu'en fin de projet, pour que "on est prêt pour le pilote" repose sur une preuve item par item et non sur une impression. Complète `docs/migration.md` (Phase 0 → Phase 1) : la sortie de Phase 0 exige "suite de tests verte, staging fonctionnel" — la suite de tests l'est (259 tests, 42 fichiers) ; **les artefacts de staging (Dockerfiles, orchestration, reverse proxy TLS, runbook) sont désormais posés (ADR-0038, `docs/deployment.md`) mais aucun serveur réel n'est encore provisionné** — voir "Ce qui bloque réellement" en bas de page.

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
| Stripe test complet | 🟡 | **Compte Stripe test réel connecté (ADR-0037-stripe, 2026-08-17)** — carte uniquement vérifiée en direct ; Bancontact/iDEAL/Apple Pay/Terminal restent non câblés (V-012/V-014), mode live non fait (V-011 à V-017) |
| Webhooks idempotents | 🟡 | `webhook.routes.ts` + tests de résilience — jamais exercé avec de vrais webhooks Stripe (le compte test connecté depuis le 2026-08-17 permettrait de le faire) |
| Paiement partagé (SPLIT) | 🟡 | Flux complet testé ; `/pay/[token]` câblé avec Stripe Elements réel (ADR-0037-stripe) mais **non re-vérifié en direct** après le correctif `automatic_payment_methods` du même lot |
| Régularisation (garantie organisateur) | 🟡 | `booking-guarantee.service.ts` codé et testé, vérifié en direct côté wallet — côté carte (`chargeSavedMethod`), le correctif Stripe est appliqué mais **pas déclenché en direct** (ADR-0037-stripe, "Négatif") |
| Wallet ledger | ✅ | Testé extensivement, **paiement 100 % wallet réellement abouti en direct** (Frontend Lot 3) |
| Packs de crédits | ✅ | **Achat réel vérifié en direct contre Stripe test** (100,00 €, wallet crédité — ADR-0037-stripe, 2026-08-17) |
| Bonus crédits | ✅ | Testé (composition payé/bonus/offert affichée et vérifiée en direct) |
| Wallet holds | ✅ | Testé (création/capture/libération), vérifié en direct (Frontend Lot 7) |
| Paiement FULL online | ✅ | **Réservation payée en carte réellement vérifiée en direct** (24,00 €, `/checkout` — ADR-0037-stripe, 2026-08-17) |
| Paiement FULL Terminal | ❌ | `StripeTerminalProvider` posé et testé unitairement mais **non câblé** dans un flux de réservation réel (V-014) |
| QR handoff | ✅ | Vérifié en direct de bout en bout, deux onglets simulant tablette + téléphone (Frontend Lot 5) |
| Paiement mixte wallet + externe | 🟡 | Codé et vérifié pour la part wallet ; la part externe utilise désormais Stripe Elements réel mais reste non re-vérifiée en direct sur ce chemin précis |
| SPLIT service fee | ✅ | Testé (ADR-0013) |
| Garantie carte off-session | 🟡 | Carte enregistrée avec succès en direct (`SetupIntent` confirmé, ADR-0037-stripe) — le déclenchement réel d'une charge off-session (`chargeSavedMethod`) reste non vérifié en direct |
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

**26 ✅ pleinement vérifiés · 9 🟡 codés et testés, non vérifiés en conditions externes réelles · 6 ⚠️ dette opérationnelle connue et documentée · 3 ❌ bloqués ou non faits** (sur 44) — mise à jour 2026-08-17 : un compte Stripe **test** réel a été connecté et vérifié en direct (carte uniquement — ADR-0037-stripe), faisant significativement progresser les items liés aux paiements. Mode live, Bancontact/iDEAL/Apple Pay et Terminal restent hors périmètre de cette avancée.

## Ce qui bloque réellement la Phase 1 (interne)

Contrairement à l'impression que pourrait donner le total ci-dessus, la Phase 1 ("comptes staff, réservations test, parcours complet") ne nécessite **pas** que les 44 items soient verts. Au 2026-08-17, un seul vrai prérequis structurel reste ouvert :

1. **Un serveur réel pour l'environnement de staging.** Les artefacts existent désormais (ADR-0038) : `apps/api/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.staging.yml`, reverse proxy Caddy avec TLS automatique, runbook complet (`docs/deployment.md`). **Un bug bloquant de production a été trouvé et corrigé au passage** : le build compilé (`npm run build && node dist/server.js`) ne démarrait pas du tout avant ce lot (résolution de module cassée pour les packages partagés) — jamais détecté car aucun lot précédent n'avait exécuté ce chemin de bout en bout. Ce qui manque encore : un serveur (VPS ou équivalent) réellement provisionné et un domaine pointant dessus — décision opérationnelle (fournisseur, coût) hors du périmètre du code — et une vérification des Dockerfiles par un vrai `docker build` (non exécutable dans l'environnement de développement utilisé pour ce lot, accès `sudo` indisponible pour démarrer le démon Docker).

Le second prérequis (compte Stripe) a été partiellement levé le même jour (ADR-0037-stripe) : un compte **test** réel est connecté, carte uniquement vérifiée en direct (checkout, packs de crédits, carte enregistrée). Reste ouvert avant un vrai pilote : passage en mode **live**, câblage Bancontact/iDEAL/Apple Pay/Terminal (V-012/V-014), et re-vérification en direct des chemins non encore redéclenchés après le dernier correctif (`/pay/[token]`, `chargeSavedMethod`).

Les gaps ⚠️ restants (terrains/tarifs réels, sauvegardes automatiques, monitoring externe, audit de sécurité externe, wording juridique SPLIT) sont réels mais n'empêchent pas de démarrer une Phase 1 restreinte à l'équipe — ils redeviennent bloquants à mesure qu'on avance vers la Phase 2 (pilote) puis le cutover (Annexe C).
