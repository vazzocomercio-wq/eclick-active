# syntax=docker/dockerfile:1.7

# ───────────────────────────────────────────────────────────
# e-Click Active — API (NestJS) Dockerfile
# Multi-stage build:
#   1. base       — Node 20 Alpine c/ deps de build (python/g++) pra
#                   módulos nativos (libsignal/baileys deps).
#   2. deps       — instala TODAS as deps do monorepo (cache layer).
#   3. builder    — buila packages/shared + apps/api (tsc).
#   4. runtime    — runtime mínimo c/ só prod deps + dist + node_modules.
# ───────────────────────────────────────────────────────────

ARG NODE_VERSION=20-alpine

# ── 1. base ────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=development

# ── 2. deps ────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/workers/package.json apps/workers/
RUN npm ci

# ── 3. builder ─────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/package-lock.json /app/turbo.json /app/tsconfig.base.json ./
COPY --from=deps /app/apps/api/package.json apps/api/
COPY --from=deps /app/apps/web/package.json apps/web/
COPY --from=deps /app/apps/workers/package.json apps/workers/
COPY --from=deps /app/packages/shared/package.json packages/shared/

# Source pra shared + api
COPY packages/shared packages/shared
COPY apps/api apps/api

# Builda shared primeiro (api importa @eclick-active/shared dele)
RUN npm run build --workspace=@eclick-active/shared
RUN npm run build --workspace=@eclick-active/api

# ── 4. runtime ─────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Instala só prod deps (npm ci --omit=dev)
COPY package.json package-lock.json turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/workers/package.json apps/workers/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copia output buildado
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/api/dist apps/api/dist

# User não-root
RUN addgroup -S nodejs && adduser -S nestjs -G nodejs && \
    chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 3001
ENV PORT=3001

# Healthcheck simples (Nest expõe / por default mas pode 404 — ajustar
# se houver endpoint /health específico)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
