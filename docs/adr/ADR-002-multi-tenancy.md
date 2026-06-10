# ADR-002 — Multi-Tenancy via Shared Schema + Postgres RLS

**Status:** Accepted · **Date:** 2026-06-10

## Context

The ERP is multi-tenant (it will be sold to many client organizations and also licensed). Tenant data must never leak across boundaries — a single cross-tenant leak is a business-ending incident. Three common models exist: database-per-tenant (strong isolation, heavy ops), schema-per-tenant (medium), and shared-schema with a `tenant_id` column (light ops, scales to many small tenants). The previous build attempted to enforce isolation only in application/repository code, added *after* modules were built — which is exactly how a forgotten `WHERE` clause or an unscoped report query leaks data.

## Decision

**Shared schema** with `tenant_id UUID NOT NULL` on every business table, enforced by **PostgreSQL Row-Level Security (RLS)** — not by application code alone.

- A per-request session variable `app.tenant_id` is `SET` on the connection from the request's `TenantContext` (carried in `AsyncLocalStorage`).
- Every tenant-owned table has RLS enabled with a policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.
- The application layer *also* scopes queries via a tenant-scoped base repository (ADR-005), giving **defense in depth**: even if app code forgets, the database denies.
- With no `app.tenant_id` set, tenant-scoped queries return **zero rows** (fail closed, never fail open).

This is established in the **foundation (chunk 1.4), before any business module exists.**

## Consequences

- Isolation is enforced at the lowest possible layer; an unscoped query is denied by the DB rather than leaking.
- Every connection must set/reset `app.tenant_id` correctly — handled centrally by a TypeORM connection hook + the `TenantInterceptor` (chunk 2.3), tested explicitly.
- Background/worker and migration contexts that operate across tenants use an explicit elevated role/path, never by leaving the variable unset accidentally.
- Per-tenant data export/deletion (GDPR-style) is a `WHERE tenant_id =` operation, not a DB drop.
- Trade-off accepted: a single large tenant cannot be physically isolated without revisiting this ADR; acceptable for the target market of many SME/enterprise tenants.

## Verification (chunk 1.4 gate)

Rows for tenant A and B; set `app.tenant_id=A` → see only A; set `=B` → see only B; set nothing → see zero.
