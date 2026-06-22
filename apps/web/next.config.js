const path = require('path');

// Security headers applied to every response (Chunk 8.x hardening). The app is same-origin only
// (web + /api on one host), no external scripts/styles/connections — so a tight-ish CSP holds.
// 'unsafe-inline' is kept for script/style because Next.js injects inline hydration scripts and
// Tailwind/runtime inject inline styles; a nonce-based CSP is the next tightening step.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"),
  "connect-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // don't advertise the framework (X-Powered-By)
  // Self-contained production server bundle for the Docker image (Chunk 9.1): Next traces the exact
  // runtime deps into `.next/standalone`, so the image needs no install step and no full node_modules.
  output: 'standalone',
  // We're in a pnpm monorepo — trace from the repo root so the standalone bundle resolves workspace
  // and hoisted deps correctly (otherwise tracing roots at apps/web and misses them).
  experimental: { outputFileTracingRoot: path.join(__dirname, '../../') },
  // Web is linted/typechecked via `pnpm --filter @app/web typecheck`; skip Next's build-time
  // ESLint so a missing eslint-config-next never blocks the skeleton build (revisit in Phase 5).
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
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
