# syntax=docker/dockerfile:1
# Production image for apps/api (Chunk 9.1).
# Multi-stage: a Debian-slim builder installs the frozen pnpm workspace, builds the shared packages
# + the app, then `pnpm deploy` prunes a self-contained production tree (prod deps only, with the
# workspace deps copied in). The runtime is Google distroless Node 22 — no shell/package manager,
# runs as the built-in non-root `nonroot` user (uid 65532). Build context = repo ROOT.

# ── base: pnpm on Node 22 ────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /repo

# ── deps: cacheable install layer (only manifests change-invalidate it) ──────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/ml/package.json apps/ml/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── build: compile shared packages + the api, then prune a prod tree ─────────
FROM deps AS build
COPY . .
RUN pnpm --filter @metaxperts/shared --filter @metaxperts/config --filter @app/api build
# --legacy: pnpm v10+ otherwise refuses to deploy a non-injected workspace (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE).
RUN pnpm --filter=@app/api --prod --legacy deploy /prod/api

# ── runtime: distroless, non-root ───────────────────────────────────────────
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production API_PORT=3000
COPY --from=build --chown=nonroot:nonroot /prod/api ./
EXPOSE 3000
# distroless has no shell — health check runs node directly (entrypoint binary at /nodejs/bin/node).
# /health/ready returns 200 only when Postgres (via PgBouncer) + Redis are reachable and not draining.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD ["/nodejs/bin/node","-e","const p=process.env.API_PORT||3000;require('http').get('http://127.0.0.1:'+p+'/health/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
# Entrypoint is `node` (distroless default); pass the script.
CMD ["dist/main.js"]
