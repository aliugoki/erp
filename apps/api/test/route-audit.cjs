/**
 * Route guard audit (Chunk 8.3 gate). Enumerates every registered route and asserts that each one
 * NOT on the public allowlist (`/health*`, `/auth/*`, `/metrics`, `/shop/*`) rejects an
 * unauthenticated request with 401 — i.e. the global JwtAuthGuard is in effect and nothing was
 * accidentally left open. `/internal/*` is `@Public()` for the user JWT but guarded by the
 * service-token guard, so it also returns 401 without credentials and passes the same assertion.
 * `/shop/:slug/*` is the customer-facing storefront: deliberately `@Public()` at the platform-JWT
 * layer (StorefrontController) and enforcing its own storefront-account token internally, so it is
 * expected to be reachable without a platform JWT.
 *
 * Usage: API_BASE=http://localhost:PORT node test/route-audit.cjs   (the API must be running)
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');

const API_BASE = process.env.API_BASE;
const PUBLIC = /^\/(health|auth|metrics|shop)(\/|$)/;

async function main() {
  // A throwaway app instance, only to enumerate the route table (no HTTP listener).
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  const server = app.getHttpAdapter().getInstance();
  const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  const routes = [];
  for (const layer of server._router.stack) {
    if (!layer.route || typeof layer.route.path !== 'string') continue;
    if (layer.route.path.includes('*')) continue; // wildcard/middleware catch-alls, not controller routes
    for (const m of Object.keys(layer.route.methods)) {
      const method = m.toUpperCase();
      if (HTTP_METHODS.has(method)) routes.push({ method, path: layer.route.path });
    }
  }
  await app.close();

  let total = 0;
  let publicCount = 0;
  const open = [];
  for (const { method, path } of routes) {
    total += 1;
    if (PUBLIC.test(path)) { publicCount += 1; continue; }
    const url = API_BASE + path.replace(/:[^/]+/g, 'x'); // fill path params
    let status = 0;
    try {
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      status = res.status;
    } catch {
      status = -1;
    }
    if (status !== 401) open.push(`${method} ${path} -> ${status}`);
  }

  console.log(`  routes audited: ${total} (public-allowlisted: ${publicCount}, guarded: ${total - publicCount})`);
  if (open.length) {
    console.log(`  ❌ UNGUARDED non-allowlisted routes (expected 401):`);
    for (const o of open) console.log(`     - ${o}`);
    process.exit(1);
  }
  console.log('  ✅ every non-allowlisted route requires authentication (401)');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
