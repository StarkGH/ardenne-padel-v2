# ADR 0023 — Parcours frontend Kiosque / QR handoff

## Statut
Accepté

## Date
2026-08-16

## Contexte

Le Lot 7 backend (ADR-0014) avait posé `KioskDevice`, `KioskCheckoutSession` et les endpoints Terminal, mais explicitement **sans les relier à un parcours utilisateur complet** — ADR-0014 §4 diffère volontairement l'intégration Stripe Terminal (capture, réconciliation avec une réservation) jusqu'à validation avec un vrai compte Stripe et un lecteur physique (V-014), et ne construit aucun frontend. Ce lot construit les écrans 1-7 du CDC §54.1 (choix réservation, identification/poursuite sur smartphone, QR de reprise, état temps réel, confirmation), en respectant strictement la frontière posée par ADR-0014 plutôt que de la repousser.

## Décision

### 1. Deux façons de continuer, une seule réutilisée intégralement : le checkout FULL existant

Le CDC distingue "Payer ici" (Terminal, écran 3) de "Continuer sur mon téléphone" (QR, écrans 4-7), mais les deux mènent en réalité à la même question : qui règle, et comment. Plutôt que de construire une collecte carte-présente réelle (qui exigerait le SDK Stripe Terminal côté client, une découverte de lecteur, et surtout un backend de capture/réconciliation qui n'existe pas — ADR-0014 l'a délibérément exclu), ce lot traite "Payer ici" comme *"le client s'identifie directement sur la tablette, puis paie immédiatement via le même écran de checkout FULL que n'importe quelle réservation en ligne"* (`/kiosk/pay` → `POST /bookings` → redirection vers `/checkout/[bookingId]`, écran déjà vérifié en direct avec un paiement 100 % wallet réellement abouti, ADR-0021). Ce choix satisfait l'intention CDC ("payer avant de quitter la tablette, sans repasser par un paiement à distance") sans construire une intégration Terminal qui ne pourrait de toute façon pas aboutir dans cet environnement (pas de lecteur physique, pas de compte Stripe réel) — et sans dupliquer la logique de checkout déjà testée. Un bouton "Lecteur Terminal" qui appellerait `/terminal/connection-token` + `/terminal/payment-intents` sans jamais pouvoir aboutir (aucune capture HTTP exposée, aucune réconciliation avec la réservation) aurait été un bouton-vitrine trompeur — à l'opposé de la discipline du projet (chaque écran de paiement dégrade proprement ou aboutit réellement, jamais de bouton mort). La vraie collecte carte-présente reste le point différé d'ADR-0014 (V-014), inchangé par ce lot.

### 2. Le QR handoff est réel de bout en bout, backend inchangé

`POST /kiosk/checkout-sessions` (authentification par dispositif, `Authorization: Bearer`), `GET /kiosk/checkout-sessions/:token` (réclamation automatique dès qu'un utilisateur authentifié consulte une session PENDING — pas d'endpoint `/claim` séparé, choix déjà acté par ADR-0014), `GET .../:id/status` (interrogé par la tablette) et `POST .../:id/cancel` sont utilisés tels quels. Aucun ajout backend n'a été nécessaire pour ce chemin. Le QR encode `${NEXT_PUBLIC_WEB_BASE_URL}/kiosk-pay/${token}` — une nouvelle route `/kiosk-pay/[token]`, construite sur le même schéma que `/pay/[token]` (écran 20, ADR-0019) : GET avant/après connexion, redirection dès que la réclamation aboutit, jamais de bouton qui rejoue une réclamation déjà consommée (un utilisateur connecté mais `claimed:false` signifie que la session est déjà `CLAIMED` par quelqu'un d'autre ou `CANCELED` — affiché comme tel, jamais un bouton "Continuer" trompeur).

### 3. `KioskCheckoutSession.status` n'atteint jamais `COMPLETED` (rappel ADR-0014) — le frontend lit `bookingStatus`, pas `status`

Confirmé en direct : après un paiement réussi côté téléphone, le statut de session reste `CLAIMED` indéfiniment ; c'est `bookingStatus` (lu via le même endpoint, qui interroge `Booking.status`) qui passe à `CONFIRMED`. L'écran 6/7 (`/kiosk/qr`) est bâti sur cette donnée, jamais sur `status`, pour ne pas dépendre d'une transition qui n'existe pas dans ce lot.

### 4. Dispositif kiosque de dev provisionné dans `prisma/seed.ts`, comme les comptes utilisateurs

Aucun écran d'administration des dispositifs kiosque n'existe encore (Lot 9 back-office, hors périmètre client). Une clé de dispositif fixe (`dev-kiosk-accueil-do-not-use-in-prod`) est donc seedée de façon idempotente, exactement comme les comptes `admin@dev.../joueur1@dev...` — pas un script ponctuel supprimé après usage (contrairement au crédit wallet manuel des lots précédents), parce que ce dispositif est nécessaire à *chaque* redémarrage de l'environnement de dev, pas à une vérification isolée. La clé brute est injectée côté frontend via `NEXT_PUBLIC_KIOSK_DEVICE_KEY` (nouveau client `kiosk-api.ts`, en-tête `Authorization: Bearer`, jamais de cookie — un kiosque n'est pas un utilisateur).

### 5. Deux bugs réels trouvés et corrigés pendant la vérification en direct

- **Double création de session sous StrictMode.** L'effet de création de session (`POST /kiosk/checkout-sessions`, un vrai effet de bord côté serveur) se déclenchait deux fois au montage en développement (double-invocation des effets par React StrictMode), créant deux sessions kiosque distinctes pour une seule visite de l'écran — la seconde écrasant la première dans l'état React sans jamais l'annuler côté serveur. Corrigé par une garde `useRef` empêchant tout second appel, avec un commentaire expliquant pourquoi (contrairement aux lectures `GET` idempotentes utilisées ailleurs dans l'app, ce POST ne l'est pas).
- **Statut jamais rafraîchi côté tablette.** L'écran 6 interroge `GET .../:id/status` toutes les 3 secondes sur la même URL ; sans `cache: "no-store"`, le navigateur servait une réponse mise en cache au lieu de repasser par le serveur, de sorte que la tablette restait bloquée sur "en attente" alors que la réservation était déjà confirmée en base. Corrigé en désactivant explicitement le cache HTTP sur le client kiosque.

Les deux ont été détectés uniquement grâce à la vérification en direct dans un vrai navigateur (deux onglets simulant tablette + téléphone) — aucun des deux n'aurait été visible en relisant le code seul.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| Construire une intégration Stripe Terminal JS SDK réelle pour l'écran 3 | Ne peut structurellement pas aboutir dans cet environnement (pas de lecteur physique, pas de compte Stripe, aucune capture HTTP exposée côté backend, aucune réconciliation avec une réservation — ADR-0014 §4) ; aurait produit un bouton-vitrine qui ne peut jamais réussir, à l'opposé de la discipline "jamais de dégradation silencieuse" du projet |
| Étendre `KioskCheckoutSession` avec un `creditPackId` optionnel pour couvrir l'écran 8 (achat/recharge crédits au bar) | Nécessite une migration de schéma et une nouvelle logique de réclamation pour un besoin non encore consommé par un écran construit dans ce lot — reporté plutôt que spéculatif ; l'achat de crédits reste accessible via `/wallet/packs` (déjà construit et vérifié, ADR-0021) pour un client identifié directement sur la tablette |
| Provisionner le dispositif kiosque de dev via un script ponctuel supprimé après usage (comme le crédit wallet manuel des lots précédents) | Le dispositif est nécessaire à chaque redémarrage de l'environnement de dev, pas seulement à une vérification isolée — un seed idempotent dans `prisma/seed.ts`, cohérent avec les comptes utilisateurs de dev, évite de le reprovisionner manuellement à chaque session |
| Servir une image QR depuis le backend | Le CDC §22.2 est explicite : le QR ne porte qu'une référence de session opaque, jamais plus — générer l'image côté client (librairie `qrcode`, aucun appel réseau supplémentaire) évite d'exposer un nouvel endpoint public juste pour du rendu visuel |

## Conséquences

**Positif :** parcours QR handoff vérifié en direct de bout en bout — sélection créneau/durée sur "tablette" (onglet 1), génération d'un vrai QR encodant l'URL de reprise, scan simulé via un second onglet ("téléphone"), connexion, réclamation automatique et création de réservation réelle, redirection dans le checkout FULL existant, **paiement 100 % wallet réellement abouti**, et mise à jour en temps réel de l'écran tablette jusqu'à l'écran de confirmation — sans jamais recharger la page tablette. Chemin "Payer ici" (identification directe + réutilisation du checkout existant) également vérifié en direct. Annulation depuis la tablette vérifiée (session marquée `CANCELED` en base). Deux bugs réels trouvés et corrigés en cours de vérification (double création de session, cache HTTP sur le polling) — la vérification en direct a, une fois de plus, trouvé des défauts invisibles à la seule lecture du code. Build et lint propres. Aucun ajout backend nécessaire pour le chemin QR ; seul un seed de dispositif de dev a été ajouté.

**Négatif / dette assumée :** l'écran 3 "Payer ici" ne collecte pas réellement une carte via un lecteur Stripe Terminal physique — satisfait l'intention utilisateur (payer immédiatement, sur place) via le checkout en ligne existant plutôt que le canal `TERMINAL` proprement dit ; la vraie intégration matérielle reste le point différé d'ADR-0014 (V-014), non traité par ce lot. Après paiement sur la tablette, le client doit se déconnecter manuellement (lien "Déconnexion" de la barre de navigation) avant de rendre l'appareil — pas de déconnexion automatique, qui aurait nécessité de propager un indicateur "mode kiosque" à travers les pages de checkout/réservation partagées entre parcours client et kiosque, hors périmètre de ce lot. Écran 8 (achat/recharge de crédits au bar) non construit en tant qu'écran kiosque dédié — reste accessible via `/wallet/packs` après identification, sans session kiosque analogue à `KioskCheckoutSession`. Les 25 écrans admin restent à construire ; aucun écran d'administration des dispositifs kiosque n'existe (Lot 9 back-office).

## Note indépendante

Deux tests backend préexistants (`bookings.http.integration.test.ts`, `concurrency.test.ts`) échouent de façon reproductible sur `main` non modifié (vérifié via `git stash`), probablement sensibles à l'heure/la date d'exécution (cutoff de délai d'annulation) — sans lien avec ce lot. Non corrigés ici ; signalés séparément pour investigation dédiée.
