# syntax=docker/dockerfile:1.7
#
# One Dockerfile, two images:
#   docker build --target web    -t sitepulse-web .
#   docker build --target worker -t sitepulse-worker .

ARG NODE_VERSION=24-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ─── Dependencies (cached until a manifest or the lockfile changes) ──────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# ─── Build ───────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @sitepulse/web build
# A self-contained copy of the worker with production dependencies only,
# workspace packages (core, db + migrations) included.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @sitepulse/worker deploy --legacy --prod /out/worker

# ─── Web: Next.js standalone server ──────────────────────────────────────
FROM node:${NODE_VERSION} AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]

# ─── Worker: scheduler, probes, incidents, alerts ────────────────────────
FROM node:${NODE_VERSION} AS worker
WORKDIR /app
ENV NODE_ENV=production HEALTH_FILE=/tmp/sitepulse-worker-healthy
COPY --from=build --chown=node:node /out/worker ./
USER node
# Healthy while the worker keeps touching HEALTH_FILE (every heartbeat with a
# working database connection).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD test -f "$HEALTH_FILE" && test $(( $(date +%s) - $(stat -c %Y "$HEALTH_FILE") )) -lt 90 || exit 1
# Node forwards SIGTERM to the worker itself (no shell), so shutdown is graceful.
CMD ["node", "--import", "tsx", "src/index.ts"]
