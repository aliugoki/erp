# syntax=docker/dockerfile:1
# Production image for apps/web (Chunk 9.1). Next.js `output: 'standalone'` traces the minimal runtime
# (a server.js + only the deps it uses) into .next/standalone; the runtime stage copies just that plus
# the static assets. Runtime is distroless Node 22, non-root. Build context = repo ROOT.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /repo

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

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
# Browser-facing API base URL is baked into the client bundle at build time. Default suits browsing on
# the host; for remote access set it to the API's public URL (e.g. http://your-host:3300) via the
# compose build arg PUBLIC_API_URL.
ARG NEXT_PUBLIC_API_URL=http://localhost:3300
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
RUN pnpm --filter @app/web build

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
# Standalone bundle mirrors the monorepo layout (tracing root = repo root): server.js lives at
# apps/web/server.js and node_modules at the bundle root. Static + public assets are copied separately
# (public holds the PWA service worker + offline shell, which must be served for offline POS to work).
COPY --from=build --chown=nonroot:nonroot /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nonroot:nonroot /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nonroot:nonroot /repo/apps/web/public ./apps/web/public
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["/nodejs/bin/node","-e","const p=process.env.PORT||3001;require('http').get('http://127.0.0.1:'+p+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"]
CMD ["apps/web/server.js"]
