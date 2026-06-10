# ADR-005 — Cross-Cutting Base Entity & Scoped Repository

**Status:** Accepted · **Date:** 2026-06-10

## Context

Soft delete, audit columns, and tenant scoping are cross-cutting — they apply to every business entity. If each module decides these for itself, they drift: one entity hard-deletes, another forgets `tenant_id`, a third has no `updatedBy`. The fix is a single shared base established before any module exists.

## Decision

**`BaseEntity`** (abstract) is inherited by every business entity:

| Column | Notes |
|---|---|
| `id` | UUID, primary key |
| `tenantId` | UUID, NOT NULL (pairs with RLS, ADR-002) |
| `createdAt` / `updatedAt` | timestamps |
| `deletedAt` | `@DeleteDateColumn` — soft delete; default queries exclude soft-deleted rows |
| `createdBy` / `updatedBy` | user id, populated from `RequestContext` |

**`TenantScopedRepository`** (base) auto-injects `tenant_id` into every `find/save/update` from `TenantContext`, so application code cannot accidentally issue an unscoped query. This is the application-layer half of ADR-002's defense in depth (RLS is the DB-layer half).

Both live in the kernel (chunk 1.4) and are mandatory.

## Consequences

- Uniform soft delete, audit, and tenancy across all 4+ modules with zero per-module boilerplate.
- A module author literally cannot create a non-tenant-scoped entity without going around the base — which the reviewer subagent checks for.
- Hard delete, when genuinely needed (e.g. GDPR erasure), is an explicit, audited operation, not the default.
- `createdBy`/`updatedBy` depend on `RequestContext` being populated (interceptor in Phase 2); system/worker writes use a system principal.
