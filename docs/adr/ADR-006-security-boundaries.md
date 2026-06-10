# ADR-006 — Security Boundaries

**Status:** Accepted · **Date:** 2026-06-10

## Context

Security that is "added later" is security that is bolted onto an already-leaky surface. The previous build left service-to-service calls (API↔ML) unauthenticated until the final hardening phase, and guarded routes only after every module was already exposed. Authentication, authorization, tenant scoping, and internal-call auth are foundational, not finishing touches.

## Decision

Security boundaries exist **before the first business module** (Phase 2, ahead of Phase 3 modules).

**Authentication (chunk 2.1):**
- JWT access token (15 min) + refresh token (7 days) with **rotation** (old refresh invalidated on use; reuse detection revokes the whole token family).
- Passwords: **argon2id** preferred (bcrypt cost 12 acceptable). Refresh tokens in Redis with TTL + family id.

**Authorization (chunk 2.2):**
- Roles: `SUPER_ADMIN, TENANT_ADMIN, HR_MANAGER, FINANCE_MANAGER, INVENTORY_MANAGER, SALES_REP, VIEWER`.
- `@Roles()` + `RolesGuard` and `@Permissions()` + `PermissionsGuard` (fine-grained, e.g. `finance:invoice:write`).
- Guards registered **globally**; the only public routes are an explicit allowlist: `/health*` and `/auth/*`. Everything else requires auth. A route-audit script (chunk 8.3) enforces this.

**Tenant binding (chunk 2.3):** every authenticated request is bound to exactly one tenant via the JWT → `TenantContext` → `app.tenant_id` (RLS, ADR-002). Tokens without a tenant are rejected.

**Service-to-service (chunk 2.4):** internal calls (API→ML, API→worker) use a **signed short-lived service token (or mTLS)** and a `ServiceAuthGuard`. The ML bridge (Phase 6) **requires** this — there is never an unauthenticated internal hop.

**Audit (chunk 2.4):** every `POST/PATCH/DELETE` is auto-logged with before/after diff, user, tenant, ip, traceId.

## Consequences

- No business endpoint is ever exposed before guards exist.
- The ML service cannot be called by anything that lacks the service token, even on the internal network.
- Refresh-token reuse (a stolen token replayed) is detected and kills the family.
- Cost: auth/RBAC/tenant plumbing is built before "visible" features — accepted, because retrofitting it is both riskier and more expensive.

## Hardening (Phase 8, builds on this baseline)

Helmet (CSP/HSTS/X-Frame-Options), CORS locked to prod origins, input sanitization + payload limits, secrets from a manager (not env files in prod), dependency + container scanning failing the build on criticals.
