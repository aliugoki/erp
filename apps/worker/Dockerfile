# syntax=docker/dockerfile:1
# Production image for apps/worker (Chunk 9.1). Same pattern as apps/api. The worker is currently a
# health surface (event reactions run in the API process per ADR-001; this app is reserved for
# scaling reactions out). Build context = repo ROOT.

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
COPY . .
RUN pnpm --filter @metaxperts/shared --filter @metaxperts/config --filter @app/worker build
# --legacy: pnpm v10+ otherwise refuses to deploy a non-injected workspace (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE).
RUN pnpm --filter=@app/worker --prod --legacy deploy /prod/worker

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production WORKER_PORT=3002
COPY --from=build --chown=nonroot:nonroot /prod/worker ./
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["/nodejs/bin/node","-e","const p=process.env.WORKER_PORT||3002;require('http').get('http://127.0.0.1:'+p+'/worker/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["dist/main.js"]
