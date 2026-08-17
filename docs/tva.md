# TVA — synthèse comptable et implications pour la plateforme

## Statut

Référence — synthèse d'un échange avec le comptable (BDO), pas une décision d'architecture actée. Alimente V-018 à V-024 de `PLAN_ACTION.md`.

## Source

- E-mail de Maïté Collignon (BDO Liège), 23/01/2026, "Synthèse des taux de TVA" — taux confirmés avec Isabelle Granata (BDO), en attente de confirmation définitive sur deux points (licence AFP, boissons non-alcoolisées).
- Deux circulaires/décisions SPF Finances jointes : Circulaire 2022/C/118 (arrêt *The Escape Center*, C-330/21 — droit d'accès à une installation sportive) et la note TaxWin sur la location de biens meubles dans le cadre d'un droit d'accès à une infrastructure.
- `T2 2026/Fichiers Connexes/*.xlsx` (fourni ensuite) — les fichiers de réconciliation comptable réels utilisés aujourd'hui par le club : template de recettes mensuel (CQFD), export du terminal de paiement bar (Nextore), export du distributeur (Nayax), rapport de paiements (caisse), analyse du compte centralisateur Belfius.

## 1. Taux confirmés

| Prestation | Taux | Base légale / statut |
|---|---|---|
| Location de terrain Padel | **6 %** | Rubrique XXVIII, tableau A, AR n°20 — droit d'accès à une installation sportive (Circulaire 2022/C/118) |
| Bon cadeau à usage unique (uniquement location de terrain) | 6 % à l'émission | Assimilé à la vente du service qu'il représente |
| Bon cadeau à usage multiple | Différé — TVA due à l'utilisation, ventilée 6 %/21 % selon ce qui est consommé | Régime des bons à usages multiples |
| Location de raquette | 21 % | Mise à disposition de biens meubles, facultative — exclue de la rubrique XXVIII (TaxWin, point 3) |
| Vente de balles / accessoires | 21 % | Vente de biens meubles |
| Licence AFP Padel | Hors TVA (débours) | *À confirmer définitivement par Isabelle Granata* |
| Snack préemballé consommé sur place (bar) | 21 % | — |
| Cubes de fromage coupés sur place (bar) | 12 % | — |
| Boissons au bar (alcoolisées ou non) | 21 % | *Changement possible pour les non-alcoolisées à partir du 01/03/2026* |
| Distributeur automatique (Nayax) | snack 6 %, boisson soft 6 %, boisson alcoolisée 21 % | Régime des livraisons de biens (comme un achat en supermarché) |

## 2. Ce que le template comptable réel révèle sur le périmètre

Le fichier `CQFD - template revenus T2 2026.xlsx` est le tableau de réconciliation mensuel réellement utilisé aujourd'hui. Il ventile les recettes en quatre familles indépendantes, chacune alimentée par un système différent :

| Famille | Système source | Taux |
|---|---|---|
| Distributeur (snack/soft/boissons) | Nayax | 6 %/6 %/21 % |
| Bar (snack, cubes fromage, boissons) | Nextore + Europabank (terminal carte) | 21 %/12 %/21 % |
| **Padel** (location terrain, location matériel, vente matériel) | **Ardenne Padel V2 (cette plateforme) + Doinsport historique** | 6 %/21 %/21 % |
| Licence AFP Padel + Bons cadeaux | Suivi manuel | 0 %/6 %/différé |

Point clé : **la plateforme ne vend aujourd'hui que ce qui tombe dans la colonne "Location de terrain"** (6 %, `Booking.priceTotalCents`) et dans les packs de crédits (wallet, dépensés exclusivement sur des réservations de terrain — donc 6 % de fait). Le distributeur (Nayax), le bar (Nextore/Europabank) et le suivi des bons cadeaux/licence restent, par construction, hors du périmètre applicatif — cohérent avec le CDC §4 qui exclut explicitement "caisse/restaurant" du développement. La colonne "Location de matériels" (raquette, 21 %) et "Vente Matériels" (balles, 21 %) apparaissent dans le tableau comptable mais ne sont vendues par aucun écran de l'application — elles sont enregistrées manuellement ailleurs (le rapprochement Belfius montre `Location raquette` et `Vente balle` comme des lignes bancaires distinctes, hors Stripe).

## 3. Analyse technique — qu'est-ce qui doit changer dans le modèle de données ?

### 3.1. Aujourd'hui : aucun champ TVA n'existe

`Booking`, `Payment`, `CreditPack`, `CreditPackPurchase`, `WalletTransaction`, `Refund` (`apps/api/prisma/schema.prisma`) stockent tous des montants en centimes bruts, sans taux ni ventilation TVA. Les prix sont implicitement TVAC (toutes taxes comprises), sans distinction.

### 3.2. Constat : pour le périmètre actuel, aucun champ n'est nécessaire

Puisque 100 % de ce que l'application facture (réservations de terrain, crédits wallet dépensés uniquement sur des réservations) correspond exactement à la colonne "Padel → Location de terrain" du tableau comptable — un **taux unique de 6 %** — il n'y a rien à ventiler côté schéma aujourd'hui. Un export mensuel se réduirait à `SUM(priceTotalCents) × 6 %`, calculable sans aucun champ supplémentaire.

Ceci reste vrai tant que :
- aucune vente de raquette/balle/accessoire n'est ajoutée à l'application (21 %, hors périmètre actuel) ;
- le wallet ne peut être dépensé que sur des réservations de terrain (vérifié : `WalletTransactionType.DEBIT_BOOKING` est le seul type de débit lié à un achat dans le code actuel — `apps/api/prisma/schema.prisma:621`).

### 3.3. Reporting TVA — construit (2026-08-17)

Le comptable reconstituait jusqu'ici le CA "Padel" manuellement pour l'insérer dans le template Excel. Un écran admin **"Chiffre d'affaires"** (`/admin/reports`, `GET /admin/reports/bookings-revenue?from=&to=`) a été ajouté : il somme `Booking.priceTotalCents` des réservations `CONFIRMED`/`COMPLETED`, groupées par jour sur `confirmedAt` (le seul instant valable pour toutes les voies de paiement — Stripe, wallet, mixte — sans sous-compter les réservations payées 100 % wallet, qui ne créent pas de ligne `Payment`), ventilées TVAC/HTVA/TVA au taux configurable `BOOKING_VAT_RATE_PERCENT` (défaut 6 %, `packages/config/src/env.ts`). Export CSV client-side pour coller directement les lignes journalières dans le template comptable existant. Limitation documentée, pas une omission silencieuse : les remboursements ne sont pas déduits (une réservation remboursée reste comptée au mois de sa confirmation).

### 3.4. Vrai risque futur : les bons cadeaux ("Bons Cadeaux")

Le template comptable a une colonne dédiée "Bon Cadeau" avec la distinction **usage unique** (6 % à l'émission, comme une vente directe) vs **usage multiple** (TVA différée à la consommation, ventilée). Cette fonctionnalité **n'existe pas du tout** dans Ardenne Padel V2 — ni côté schéma, ni côté écran. Le `CreditPack`/wallet actuel est un mécanisme de rechargement multi-usage classique (prépaiement), pas un bon cadeau au sens fiscal du terme, et n'a jamais eu besoin de cette distinction *parce qu'il n'est dépensable que sur du 6 %*.

Si le club veut un jour vendre des bons cadeaux **via l'application** (aujourd'hui gérés manuellement, hors plateforme, vu leur présence dans le tableau comptable mais absence dans le code), il faudrait alors :
1. Un champ ou un type distinguant bon "usage unique" (6 %, TVA due à l'émission) vs "usage multiple" (TVA différée à l'utilisation) — probablement un nouveau modèle plutôt qu'une extension de `CreditPack`, pour ne pas mélanger deux sémantiques fiscales différentes (même logique que la décision prise pour `EmailChangeToken` vs `EmailVerificationToken`, ADR-0027).
2. Une traçabilité de ce sur quoi un bon "usage multiple" est effectivement dépensé, pour ventiler correctement au moment de la consommation — aujourd'hui, `WalletTransaction.bookingId` suffirait pour la seule dépense possible (réservation, 6 %), mais pas si le wallet devient dépensable sur autre chose (bar, matériel) via l'app.

Non fait — hypothétique, pas dans le périmètre actuel du CDC ni demandé.

### 3.5. Distributeur et bar : hors périmètre applicatif, intentionnellement

Nayax (distributeur) et Nextore/Europabank (bar) restent des systèmes tiers non intégrés à la plateforme, cohérent avec l'exclusion explicite de "caisse/restaurant" au CDC §4. Aucune implication pour le modèle de données de l'application.

## 4. Conclusion

Le périmètre réellement couvert par la plateforme (réservations de terrain à 6 %, wallet dépensé exclusivement dessus) ne nécessitait aucun changement de schéma. L'export de chiffre d'affaires pour l'admin (§3.3) est construit. Reste identifié mais non demandé : seulement si le club veut un jour vendre des bons cadeaux via l'application plutôt qu'au comptoir, un modèle de bon cadeau distinguant usage unique/multiple (§3.4). Points encore en attente côté comptable : confirmation définitive du traitement de la licence AFP et de l'éventuel changement de taux sur les boissons non-alcoolisées au 01/03/2026 — aucun des deux ne concerne le code de la plateforme.
