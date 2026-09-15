# ADR 0039 — Nextore V2 comme module du monolithe, pas un service séparé

## Statut
Accepté

## Date
2026-09-15

## Contexte

Le CDC `CDC_Nextore_V2_Codex_Claude.md` (caisse bar : comptes ouverts, splits, sessions de caisse, paiements cash/carte/crédits) impose une phase d'audit obligatoire avant tout développement (§0) et interdit explicitement de dupliquer un référentiel déjà maintenu ailleurs (§0.1).

L'audit Phase 0 (rapport séparé, hors dépôt) a confronté le CDC à l'état réel de l'écosystème :

- `ardenne-padel-v2` (ce dépôt) possède déjà un `WalletAccount`/`WalletTransaction` en ledger append-only (Lot 5, ADR-0007), un RBAC hiérarchique (`Role`), un `AuditLog` append-only (Lot 9), et un `User`/CRM déjà source de vérité client.
- Le pipeline `ardenne-padel-pnl` (dépôt séparé, Node.js batch, sans framework HTTP) possède déjà un référentiel produit interne normalisé (`nextore_products`/`supplier_products`/`product_mappings`) et un moteur de coût matière (`listNextoreCostOverview`), alimentés depuis les factures fournisseurs et les exports de l'ancien Nextor.
- Le terminal carte physique du bar est un Loyaltek 9220 connecté à Europabank — distinct du flux Stripe (réservations en ligne).
- Le club exploite un seul poste de caisse (un seul terminal physique) — confirmé par les registres réels de l'ancien Nextor (249 sessions, 16/10/2025→14/09/2026, ~9 086 tickets, ~39,5 tickets/jour en moyenne).

## Décision

### Nextore V2 est un nouveau domaine (`apps/api/src/modules/nextore/`) dans ce monorepo, pas un service HTTP séparé

Raison principale : **l'atomicité du débit de crédits**. Un paiement bar par crédits doit débiter `WalletAccount` de façon fiable (CDC §6.3 : "un débit de crédits doit être atomique"). Dans le même processus/même base Postgres, cela se fait par une écriture ledger classique (voir `WalletService.debitForNextoreAccount`, symétrique à `debitForBooking`) suivie d'une vérification de solde avant écriture — la même garantie qu'un appel réseau entre deux services imposerait de reconstruire avec un pattern de compensation (saga, outbox) pour un bénéfice architectural nul ici : il n'y a aucune raison de déployer/scaler Nextore indépendamment du reste (CDC §4 exclut explicitement les microservices "parce que c'est moderne", §52).

Conséquence directe : Nextore réutilise directement, sans API ni duplication :
- `User`/`CrmRepository.searchUsers` pour la recherche client (ACC-002) ;
- `WalletAccount`/`WalletService` pour les crédits (PAY-003/PAY-005), étendu de deux types de transaction (`DEBIT_NEXTORE_ACCOUNT`/`REFUND_NEXTORE_ACCOUNT`) plutôt qu'un second solde ;
- `AuditLogService` pour la traçabilité (AUD-*) ;
- `Role`/`requireRole` pour le RBAC (RBAC-*).

### PNL reste un dépôt séparé, avec une API de lecture ajoutée plutôt qu'une fusion

Fusionner PNL dans ce monorepo aurait été un changement de nature (PNL est un pipeline Node.js batch sans framework HTTP, avec sa propre base Postgres et ses propres conventions d'import) pour un bénéfice marginal — le vrai besoin est que Nextore V2 **lise** le référentiel produit/coût déjà là, pas qu'il en devienne co-propriétaire. Solution retenue (voir `ardenne-padel-pnl/src/apps/nextore-read-api.js`) : un habillage HTTP en lecture seule au-dessus des fonctions déjà utilisées par l'UI d'administration PNL existante (`listNextoreProducts`, `listMappingsForNextoreProduct`, `listNextoreCostOverview`) — aucune nouvelle requête métier, clé API partagée (même logique que `KioskDevice`/`AccessDevice` : secret opaque, pas de notion d'utilisateur), lié uniquement en `127.0.0.1` sur le VPS (pas d'exposition publique). Nextore V2 doit synchroniser périodiquement cette liste plutôt que d'interroger PNL en direct au moment de la vente (POS-009 : le POS ne doit jamais attendre un recalcul externe) — la couche de consommation côté Nextore reste à construire (hors scope du lot livré, catalogue admin uniquement pour l'instant).

### Pas de nouveau système de caisse générique : le CDC est adapté au fait qu'un seul poste existe

`NextoreCashSession`/`NextoreCashMovement` (Lot G) supposent explicitement une seule session ouverte à la fois (`findOpenSession` unique, erreur `CashSessionAlreadyOpenError` sur double ouverture) — plutôt qu'un modèle multi-caisses non demandé et non nécessaire à ce stade (CDC §69 : anticiper n'est pas développer prématurément). Si le club ouvre un second poste de caisse un jour, ce sera un changement de modèle explicite, pas une généralisation spéculative aujourd'hui.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Service Nextore séparé avec appels API vers `ardenne-padel-v2` pour crédits/clients | Casse l'atomicité du débit de crédits sans bénéfice réel ; aucun besoin de scaling/déploiement indépendant identifié |
| Fusionner PNL dans ce monorepo | Changement de nature disproportionné (pipeline batch vs API HTTP) pour un besoin de lecture seule |
| Schéma de données partagé entre bases avec synchronisation bidirectionnelle | Duplication de fait du référentiel produit — exactement l'anti-pattern interdit par le CDC §52 |
| Modèle de caisse multi-postes dès le départ | Aucun second poste physique n'existe ; sur-ingénierie spéculative |

## Conséquences

**Positif :** débit de crédits atomique par construction (même transaction logique que le reste du wallet) ; RBAC/audit/client réutilisés sans nouvelle surface d'authentification ; PNL reste la seule source de vérité produit/coût, consultée jamais dupliquée.

**Négatif / dette assumée :** Nextore V2 et le reste du monolithe partagent désormais un même cycle de build/déploiement (un changement Nextore nécessite de reconstruire toute l'image `api`) — accepté car cohérent avec le pattern déjà en place pour tous les autres domaines (booking, wallet, kiosk, automation) de ce dépôt. La consommation effective de l'API de lecture PNL côté catalogue Nextore (synchronisation périodique de `internalProductRef`) n'est pas encore implémentée — prochain incrément naturel une fois le catalogue utilisé en conditions réelles.
