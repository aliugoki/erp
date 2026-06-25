# ADR-010 — Permission-level RBAC (custom roles)

**Status:** Accepted · **Date:** 2026-06-25 · **Extends:** ADR-006 (security boundaries)

## Context

ADR-006 established coarse role-based access (`@Roles`) with a fixed `Role` enum. As the product is
sold to many companies, customers need to define their **own** roles — and not just bundles of the
built-in roles, but roles scoped to *individual capabilities* (e.g. "can read invoices but not post
them"). The codebase enforced authorization with ~265 `@Roles` checks and only a single `@Permissions`
use, so fine-grained permissions gated nothing real.

This was delivered in four phases (see `docs/permission-rbac-scope.md`): a permission **catalog** +
**dual-run** shadow harness (A), per-module **shadow tagging** + authorization-matrix tests with zero
divergences (B), the **flip** to permission enforcement (C), and **cleanup** (D).

## Decision

**Authorization is enforced by fine-grained permission**, formatted `domain:resource:action`, defined
in a central catalog (`auth/rbac/permission-catalog.ts`).

- **Built-in roles map to permission sets** (`ROLE_PERMISSIONS`). `SUPER_ADMIN` / `TENANT_ADMIN` hold
  the `*` wildcard. The built-in `Role` enum and its expansion (ADR-009 composite custom roles) remain.
- **Custom roles** (`tenant_role`, per-tenant, RLS) may grant **capability presets** (`member_roles`,
  expanded to built-in roles) **and/or** arbitrary **catalog permissions** (`permissions`). A role can
  be capabilities-only, permissions-only, or both. Managed by a company's own `TENANT_ADMIN`.
- **Effective permissions** are resolved at token issue (`RbacService.effectivePermissionsForUser`,
  Redis-cached) = built-in role permissions ∪ each custom role's member-role permissions ∪ its direct
  permissions, and carried in the access token's **`perms` claim**.
- **Enforcement:** a business endpoint declares `@Permissions('domain:resource:action')`;
  `PermissionsGuard` allows it iff the principal's `perms` include the required permission (or `*`).
  `RolesGuard` is retained **only** for platform/admin routes that carry `@Roles` and no permission tag
  (e.g. `@Roles(SUPER_ADMIN)` on tenant provisioning); on permission-tagged routes it defers.
- The access token also keeps the `roles` claim (built-in-expanded) for those `@Roles` platform routes
  and for `SUPER_ADMIN` short-circuits (feature catalog, FeatureGuard).

## Consequences

- A `TENANT_ADMIN` can compose least-privilege roles from a permission catalog; access is enforced by
  the backend on every request, never by the UI alone.
- Permission/role changes take effect on the next token refresh, or immediately when the change path
  revokes the user's sessions (role/password edits already do).
- The catalog is the single source of truth: a new protected action adds a catalog entry, grants it to
  the relevant built-in role(s), and tags its endpoint with `@Permissions`. An authorization-matrix
  test (`*-authz-matrix.spec.ts`) asserts every permission maps to the intended principals.
- `@Roles` on business endpoints is now redundant and has been removed; it survives only on platform
  routes. Re-introducing a role-only business check is a regression — gate by permission instead.
- Trade-off accepted: enforcement resolves permissions per principal at token issue (cached); a very
  large permission set per user would grow the token — acceptable for the catalog's size.

## Verification

Per-module authorization-matrix unit tests (finance / helpdesk / module / phase-b-batch specs) assert
the permission→principal mapping; Phase B ran a dual-run shadow with **zero divergences** across every
module before the flip. Live: built-in roles behave identically (no-op flip); a permission-only custom
role reaches exactly its granted endpoint and is denied all others; admin-only endpoints stay
admin-only.
