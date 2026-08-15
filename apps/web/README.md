# Ardenne Padel — Web (PWA)

Frontend Next.js (App Router, TypeScript, Tailwind) — voir le README à la racine du dépôt pour l'installation complète et `docs/adr/0019-frontend-fondations.md` pour les décisions structurelles de ce module.

## Démarrage

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_BASE_URL
npm run dev --workspace apps/web
```

Nécessite l'API (`apps/api`) déjà lancée sur `http://localhost:3000` — voir le README racine.

Disponible sur `http://localhost:3001`.

## Structure

```
src/
  app/            routes (App Router)
  components/     composants UI partagés
  lib/            client API, types, contexte de session, utilitaires date
public/           manifest PWA, icône
```
