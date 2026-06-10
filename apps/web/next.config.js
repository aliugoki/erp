/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Web is linted/typechecked via `pnpm --filter @app/web typecheck`; skip Next's build-time
  // ESLint so a missing eslint-config-next never blocks the skeleton build (revisit in Phase 5).
  eslint: { ignoreDuringBuilds: true },
};

module.exports = nextConfig;
