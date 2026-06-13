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
};

module.exports = nextConfig;
