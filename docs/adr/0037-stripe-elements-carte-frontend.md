# ADR 0037 — Stripe Elements (carte) côté frontend

## Statut
Accepté

## Date
2026-08-17

## Contexte

Le backend Stripe (PaymentIntent manuel, SetupIntent, webhook, `StripePaymentProvider`) existait depuis les premiers lots (ADR-0010), mais aucune surface frontend ne collectait réellement une carte via Stripe.js : les quatre parcours de paiement (`/checkout/[bookingId]`, `/pay/[token]`, l'achat de packs de crédits, `/profile/payment-methods`) envoyaient tous un `paymentMethodId` codé en dur (`pm_card_visa`, un jeton valable uniquement en mode test Stripe) ou, pour `/profile/payment-methods`, appelaient `POST /payments/setup` sans jamais confirmer le `SetupIntent` résultant — "Ajouter une carte" n'enregistrait rien.

Un compte Stripe réel (test) a été créé et connecté (clés dans `apps/api/.env` / `apps/web/.env.local`) dans ce même lot, permettant de coder et vérifier contre l'API Stripe réelle plutôt que des mocks.

Portée choisie explicitement avec l'utilisateur : **carte uniquement**. Bancontact/iDEAL exigeraient de restructurer le flux backend (PaymentIntent non confirmé + `PaymentElement` + redirection `return_url`), reporté à un lot ultérieur.

## Décision

### 1. `@stripe/stripe-js` + `@stripe/react-stripe-js`, un `<Elements>` par page

Chaque surface de paiement est scindée en un composant externe qui pose `<Elements stripe={getStripe()}>` et un composant interne qui consomme `useStripe()`/`useElements()` — nécessaire car ces hooks exigent d'être sous `<Elements>`. `getStripe()` (`lib/stripe.ts`) mémorise la `Promise<Stripe>` unique via `loadStripe(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)`.

### 2. `StripeCardField` partagé, `CardElement` unique (pas `PaymentElement`)

Un seul composant (`components/stripe-card-field.tsx`) enveloppe `<CardElement>` avec un style repris de `TextInput` (CDC : cohérence visuelle). `CardElement` plutôt que `PaymentElement` : ce dernier orchestre nativement plusieurs moyens de paiement dont des flux à redirection, hors scope de ce lot.

### 3. Deux patrons de confirmation selon le contrat existant, aucun changement de contrat

- **Paiement immédiat** (`/checkout`, `/pay/[token]`, packs de crédits) : `stripe.createPaymentMethod({ type: "card", card })` côté client → `pm_xxx` envoyé comme `paymentMethodId` aux endpoints existants (`POST /payments/checkout`, `POST /booking-shares/:token/pay`, `POST /credit-packs/:id/purchase`), qui l'acceptaient déjà en paramètre optionnel. Aucun changement de route backend nécessaire pour ces trois surfaces.
- **Carte enregistrée** (`/profile/payment-methods`) : `POST /payments/setup` renvoie un `clientSecret` (jusque-là ignoré), confirmé côté client via `stripe.confirmCardSetup(clientSecret, { payment_method: { card } })`. Stripe attache automatiquement le moyen de paiement au `Customer` en cas de succès — aucun appel `paymentMethods.attach()` explicite requis.

### 4. Correctif backend découvert en vérification live : `automatic_payment_methods[allow_redirects]`

La première confirmation réelle contre l'API Stripe (`POST /payments/checkout`) a échoué : `StripeInvalidRequestError` — "this PaymentIntent is configured to accept payment methods enabled in your Dashboard [...] you must provide a `return_url`". Le compte Stripe a plusieurs moyens de paiement activés par défaut (dont des moyens à redirection type Bancontact/iDEAL), et `paymentIntents.create` ne restreignait pas explicitement `payment_method_types`. Comme la confirmation ici est toujours synchrone sans gestion de redirection, le correctif est `automatic_payment_methods: { enabled: true, allow_redirects: "never" }` sur les deux points de création de `PaymentIntent` (`createPayment`, `chargeSavedMethod` dans `StripePaymentProvider`) — garde le contrôle des moyens de paiement au Dashboard (CDC §21.2 : "ne pas coder une logique métier par nationalité") tout en excluant les moyens à redirection sur ce chemin synchrone précis. Propagé à travers `StripeClientPort` (le port explicite) et `stripe-client.ts` (l'adaptateur SDK réel), qui ne retransmettaient jusque-là qu'un sous-ensemble fixe de champs.

## Alternatives considérées

| Option | Écartée pourquoi |
|---|---|
| `PaymentElement` dès ce lot (couvre Bancontact/iDEAL nativement) | Exige un `PaymentIntent` non confirmé créé côté serveur en amont + gestion de redirection (`return_url`, retour de page) ; changement de contrat API plus large que "carte uniquement", explicitement écarté par l'utilisateur pour ce lot |
| Restreindre `payment_method_types: ["card"]` au lieu de `automatic_payment_methods[allow_redirects]` | Fonctionnerait aussi, mais fige la liste des moyens au code plutôt qu'au Dashboard — contredit directement CDC §21.2 ; `allow_redirects: "never"` laisse le Dashboard gouverner *quels* moyens sans redirection sont proposés (ex. futur ajout d'Apple/Google Pay) |
| `paymentMethods.attach()` explicite après `confirmCardSetup` | Redondant : Stripe attache automatiquement le `PaymentMethod` au `Customer` dès qu'un `SetupIntent` avec `customer` défini se confirme avec succès (comportement natif de l'API, vérifié en direct) |

## Conséquences

**Positif :** vérifié en direct de bout en bout contre le compte Stripe test réel avec une carte de test (`4242 4242 4242 4242`) : carte enregistrée avec succès sur `/profile/payment-methods` (Visa •••• 4242, exp. 12/2028, via `SetupIntent` confirmé), réservation payée en carte sur `/checkout` (24,00 €, réservation confirmée), pack de crédits acheté (100,00 €, wallet crédité). Build production (`next build`, 39 routes) et `tsc --noEmit` propres sur `apps/web`. 259 tests backend passent après le correctif `automatic_payment_methods`, y compris les 52 tests du module `payments` inchangés dans leur comportement.

**Négatif / dette assumée :** Bancontact, iDEAL, Apple/Google Pay restent non câblés (CDC §21.2, V-012) — nécessitent le `PaymentElement` + flux de redirection, hors scope choisi. `/pay/[token]` (financement `EXTERNAL` d'une part SPLIT) suit exactement le même patron que `/checkout` et n'a pas été revérifié en direct après le correctif `automatic_payment_methods` (seul le chemin `/payments/checkout` a été testé en direct ; `chargeSavedMethod`, utilisé par la garantie organisateur SPLIT hors-session, reçoit le même correctif mais n'a pas non plus été déclenché en direct dans ce lot) — couverts par les 52 tests automatisés du module `payments`, pas par une vérification navigateur.
