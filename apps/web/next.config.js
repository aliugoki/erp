const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained production server bundle for the Docker image (Chunk 9.1): Next traces the exact
  // runtime deps into `.next/standalone`, so the image needs no install step and no full node_modules.
  output: 'standalone',
  // We're in a pnpm monorepo — trace from the repo root so the standalone bundle resolves workspace
  // and hoisted deps correctly (otherwise tracing roots at apps/web and misses them).
  experimental: { outputFileTracingRoot: path.join(__dirname, '../../') },
  // Web is linted/typechecked via `pnpm --filter @app/web typecheck`; skip Next's build-time
  // ESLint so a missing eslint-config-next never blocks the skeleton build (revisit in Phase 5).
  eslint: { ignoreDuringBuilds: true },
  // Same-origin API proxy: the browser calls `/api/*` on the web origin and the Next server forwards to
  // the API over the internal docker network. So only the web port needs to be public — the API never
  // has to be exposed, with no cross-origin/CORS or second-port firewall hole. Pair with the client
  // setting NEXT_PUBLIC_API_URL=/api. Override the upstream with API_PROXY_TARGET if needed.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET || 'http://api:3000';
    return [{ source: '/api/:path*', destination: `${target}/:path*` }];
  },
};

module.exports = nextConfig;
