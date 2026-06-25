# Scope — Path 2: Permission-level RBAC

**Status:** Proposal (not yet scheduled) · **Author:** platform · **Supersedes (on acceptance):** parts of ADR-006
**Becomes:** ADR-010 when accepted.

This document scopes the migration from **role-based** authorization to **fine-grained permission-based**
authorization, so that custom roles can grant *arbitrary individual permissions* rather than bundles of
built-in capability roles (Path 1, already shipped).

---

## 1. Why

Today (after Path 1) a company admin builds a custom role by **combining the six built-in capability
roles** (HR, Finance, Inventory, Sales, Support, Viewer). That is enforced and useful, but coarse: you
cannot express *"can read invoices but not post them"* or *"can issue POS refunds but not voids."*
Permission-level RBAC lets a custom role be **any subset of a catalog of permissions**.

## 2. Current state (what Path 2 must change)

- **Enforcement is by role.** `@Roles(...)` appears on **~265** endpoints; `@Permissions(...)` on **1**
  (a demo probe). So permissions presently gate nothing real.
- `ROLE_PERMISSIONS` (in `auth/rbac/permissions.ts`) maps each built-in role → a static permission set.
  Only ~14 permission strings exist; they do **not** cover most endpoints.
- `SUPER_ADMIN` and `TENANT_ADMIN` hold the `*` wildcard.
- Path 1's `tenant_role.member_roles` bundles built-in roles; `AuthService` expands a user's assigned
  roles to built-ins in the access token, and `@Roles` enforces.
- `PermissionsGuard` already exists and is wired as a global `APP_GUARD`; it computes
  `rolesHavePermission(user.roles, required)` synchronously from the static map.

**Implication:** the hard part is not the data model — it is **(a) defining a permission for every
protected action** and **(b) safely switching 265 enforcement points from role checks to permission
checks** without opening or breaking access.

## 3. Target model

1. **Permission catalog** — a code-defined registry of permissions, `domain:resource:action`
   (e.g. `finance:invoice:read`, `finance:voucher:post`, `pos:sale:refund`). Grouped by module for the
   role-builder UI. This registry is the single source of truth and is surfaced via
   `GET /tenant/roles/permissions` (alongside today's `/capabilities`).
2. **Custom roles carry permissions.** `tenant_role` gains `permissions text[]` (keep `member_roles`
   for backward-compat / "preset" convenience). A custom role's effective permission set =
   `union(permissions, perms-of(member_roles))`.
3. **Effective permissions resolution.** A user's effective permissions =
   `union over assigned roles of (built-in ROLE_PERMISSIONS | custom-role permissions)`, with `*` for
   admins. Resolved per request via a Redis-cached `RbacService.permissionsForUser(tenantId, roles)`
   (same caching pattern as feature entitlements), so changes take effect immediately and the token
   stays small. The JWT carries **assigned role keys** (not an expanded permission list).
4. **Enforcement by permission.** Every protected endpoint declares `@Permissions('domain:res:action')`.
   `PermissionsGuard` becomes async and resolves effective permissions via `RbacService`. `@Roles`
   remains only where a check is genuinely role-shaped (e.g. `SUPER_ADMIN`-only platform routes).

## 4. Work breakdown (phased, de-risked)

Each phase is independently shippable and leaves the system **green and enforcing** (no half-migrated
gap). Default-deny is preserved throughout.

**Phase A — Catalog + resolution (no enforcement change). ✅ SHIPPED.**
- ✅ Permission catalog registry (`auth/rbac/permission-catalog.ts`), grouped by module.
- ✅ `ROLE_PERMISSIONS` formalised against the catalog; a unit test (`test/rbac-permissions.spec.ts`)
  asserts mutual consistency (every catalog perm granted by some role and vice-versa).
- ✅ `RbacService.effectivePermissions(roles)` (synchronous — the JWT carries built-in-expanded roles,
  so no DB lookup) + `GET /tenant/roles/permissions` (catalog + caller's effective perms).
- ✅ **Dual-run harness:** `@ShadowPermissions(...)` decorator + `PermissionsGuard` shadow path —
  **log-only**, never blocks; logs a `RbacShadow` divergence when a role-allowed principal would be
  denied by the permission model. Piloted on `POST hr/employees`, `POST inventory/products`,
  `POST finance/invoices` (consistent today → 0 divergences, the healthy signal).
- ▶ **Next (still Phase A → B boundary):** widen `@ShadowPermissions` tagging module-by-module and
  watch the `RbacShadow` logs to find real role/permission gaps before Phase C flips enforcement.

**Phase B — Tag endpoints (module by module).** ▶ IN PROGRESS.
- For each module, add `@ShadowPermissions(...)` next to the existing `@Roles(...)` (log-only; cannot
  open access), grow the catalog in lockstep, and add an **authorization matrix test** asserting the
  permission maps to the same principals the role check allows. One PR per module group.
- ✅ **Finance** — all 26 role-gated write endpoints tagged; finance permission group grown to 14
  (`account`/`voucher` write+post / `invoice` / `bill` / `payment` / `vendor` / `customer` / `period` /
  `reconciliation` / `costcenter` / `budget` / `currency`); `test/finance-authz-matrix.spec.ts` asserts
  every finance write perm maps to FINANCE_MANAGER + admins only. Live: a real FINANCE_MANAGER exercises
  the tagged writes with **0 divergences**.
- ☐ Remaining modules: HR, Inventory, CRM, Sales, POS, Helpdesk, Projects, Assets, Production, Pharmacy,
  Ecommerce, Subscriptions, Reporting, AI (one PR each; HR/Inventory/CRM already have a pilot tag).

**Phase C — Flip to permissions.**
- Once all modules are tagged and matrix-green, remove the redundant `@Roles(...)` from business
  endpoints (keep `@Roles(SUPER_ADMIN)` on platform routes). `PermissionsGuard` is now authoritative.
- `tenant_role.permissions` migration; role-builder UI switches to a grouped **permission checkbox**
  picker (keeping the capability-bundle shortcut as presets).
- Stop expanding custom roles to built-ins in the token; resolve permissions instead.

**Phase D — Cleanup.**
- Remove dead role-permission shims; write ADR-010; update `CLAUDE.md` and this doc's status.

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| A missed mapping **opens** an endpoint (privilege escalation) | Default-deny; Phase B keeps `@Roles` AND `@Permissions` (tighter); exhaustive matrix tests; per-module review. |
| A wrong mapping **breaks** a workflow | Dual-run divergence telemetry (Phase A) surfaces mismatches before the flip; matrix tests encode intended access. |
| Token/perf cost | Per-request resolution is Redis-cached per `(tenant, role-set)`, like feature entitlements; admins short-circuit on `*`. |
| Cross-tenant audit under `runFor` | Already solved: `AuditService.recordWith(…, tenantOverride)`. |
| Big-bang regression | Strictly phased; each phase ships green; flip (Phase C) is one reviewable change after matrix coverage exists. |

## 6. Testing & acceptance

- **Authorization matrix** generated from the catalog: endpoint × principal → expected outcome. This is
  the primary safety net and must be green before Phase C.
- Existing e2e (`rbac-e2e.sh`, `security-e2e.sh`) extended with permission cases.
- Acceptance: a custom role with exactly `finance:invoice:read` can read invoices and is denied invoice
  writes and all other modules; an admin (`*`) is unaffected.

## 7. Rough size

~6–10 chunks: Phase A (1–2), Phase B (1 per module group → ~4–6), Phase C (1–2), Phase D (1).
Token cost is not the constraint; **review + test rigor per module** is.

## 8. Open questions (decide before Phase A)

1. **Granularity:** start at `module:resource:action`, or coarser `module:action`? (Recommend
   `module:resource:action`, but seed the catalog only with actions that have a real enforcement point.)
2. **Read endpoints:** several reads are currently gated only by `@RequiresFeature` (not `@Roles`). Do we
   introduce read permissions for them, or leave reads feature-gated only? (Recommend: leave as-is unless
   a customer needs read restrictions, to bound scope.)
3. **Keep `member_roles` presets** in the role builder as a convenience, or permissions-only?
   (Recommend: keep as presets that expand into permissions.)
