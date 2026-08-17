# Contexte de build attendu : la racine du monorepo (voir docker-compose.staging.yml)
# — nécessaire pour installer les workspaces packages/* dont dépend cette image.

FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/domain/package.json packages/domain/package.json
# npm ci a besoin de tous les workspaces déclarés dans le lockfile, même ceux
# non utilisés par cette image (apps/web) — sinon `npm ci` échoue.
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build:packages \
  && npm run prisma:generate --workspace apps/api \
  && npm run build --workspace apps/api

# Image d'exécution : node_modules complet (pas d'élagage dev/prod à ce
# stade, voir ADR-0037 "Restant") + uniquement les dist/ compilés, jamais
# les sources TS.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/config/dist ./packages/config/dist
COPY --from=build /app/packages/config/package.json ./packages/config/package.json
COPY --from=build /app/packages/domain/dist ./packages/domain/dist
COPY --from=build /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma

WORKDIR /app/apps/api
EXPOSE 3000
# Les migrations (`npm run prisma:migrate:deploy`) sont un pas de release
# séparé (voir docs/deployment.md), jamais rejouées automatiquement au
# démarrage — éviter une course entre plusieurs instances qui migreraient
# en même temps.
CMD ["node", "dist/server.js"]
