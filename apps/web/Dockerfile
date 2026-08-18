# Contexte de build attendu : la racine du monorepo (voir docker-compose.staging.yml).

FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/domain/package.json packages/domain/package.json
# --ignore-scripts : le postinstall du workspace apps/api (`prisma
# generate`) se déclenche aussi ici (npm ci l'exécute pour tous les
# workspaces du lockfile, pas seulement apps/web) et échouerait sans
# prisma/schema.prisma, absent à ce stade — voir le même correctif dans
# apps/api/Dockerfile. Le client Prisma n'est de toute façon jamais utilisé
# par cette image (apps/web ne parle qu'à l'API HTTP).
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
# CDC §57.1 : ce sont les seules variables inlinées côté client par Next.js
# (préfixe NEXT_PUBLIC_) — aucune ne doit être un secret, juste des valeurs
# publiques (URL d'API, clé publishable Stripe).
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_WEB_BASE_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_KIOSK_DEVICE_KEY
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_WEB_BASE_URL=$NEXT_PUBLIC_WEB_BASE_URL
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_KIOSK_DEVICE_KEY=$NEXT_PUBLIC_KIOSK_DEVICE_KEY
RUN npm run build --workspace apps/web

# `output: "standalone"` (next.config.ts) trace uniquement les fichiers/deps
# réellement utilisés — image finale sans le node_modules complet du monorepo.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

WORKDIR /app/apps/web
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
