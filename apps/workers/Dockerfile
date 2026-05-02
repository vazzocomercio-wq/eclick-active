# syntax=docker/dockerfile:1.7

# ───────────────────────────────────────────────────────────
# e-Click Active — Workers (Baileys / WhatsApp) Dockerfile
# Multi-stage Node 20 Alpine. Workers expõe internal-server em 3030
# (loopback-only via INTERNAL_API_KEY) — Railway pode opcionalmente
# expor pra outros services.
# ───────────────────────────────────────────────────────────

ARG NODE_VERSION=20-alpine

# ── 1. base ────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base
WORKDIR /app
# libc6-compat: necessário pra protobufjs/baileys em Alpine
# python3+make+g++: build de módulos nativos (libsignal usa node-gyp)
RUN apk add --no-cache libc6-compat python3 make g++
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

COPY packages/shared packages/shared
COPY apps/workers apps/workers

RUN npm run build --workspace=@eclick-active/shared
RUN npm run build --workspace=@eclick-active/workers

# ── 4. runtime ─────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/workers/package.json apps/workers/
# Workers precisa de python/make só pra build — runtime sem isso
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/workers/dist apps/workers/dist

# User não-root
RUN addgroup -S nodejs && adduser -S worker -G nodejs && \
    chown -R worker:nodejs /app
USER worker

EXPOSE 3030
ENV WORKER_INTERNAL_PORT=3030

# Workers escreve heartbeat — fallback healthcheck via process tree
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_INTERNAL_PORT||3030)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || exit 0

CMD ["node", "apps/workers/dist/index.js"]
