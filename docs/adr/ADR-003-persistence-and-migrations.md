# ADR-003 — Persistence & Migrations

**Status:** Accepted · **Date:** 2026-06-10

## Context

TypeORM offers `synchronize: true`, which auto-applies entity changes to the schema. It is convenient early and catastrophic later: it leaves no migration history, can silently drop columns/data, and makes "write the migrations at the end" mean reverse-engineering the entire schema from current entities. The previous build deferred migrations to the final phase — guaranteeing exactly that problem.

## Decision

- **`synchronize: false` from the very first entity.** No exceptions, no "just for local."
- **Every** schema change is a reviewed TypeORM migration committed alongside the entity change.
- Migrations are **idempotent** (running `migration:run` twice leaves the second run a no-op) and **reversible** (a tested `down`).
- The full migration set must run **clean from an empty database** at any time (verified in chunk 9.2).
- A standalone TypeORM `DataSource` is provided for the migration CLI from chunk 1.3.
- DB-only artifacts (RLS policies, functions, materialized views, extensions like `pgvector`) are created **in migrations**, with an `include_object`-style guard so the ORM never tries to diff/manage them.
- Applied migrations are **immutable**. A mistake is fixed by a new corrective migration, never by editing an applied one.

## Consequences

- Continuous, auditable schema history from day one; safe rollbacks; reproducible environments.
- Slightly more friction per entity change (write + review a migration) — accepted as the cost of safety.
- Local resets use `infra:reset` → migrate → seed, never `synchronize`.
- Pairs with ADR-002: RLS policies and the per-request session variable plumbing live in migrations + a connection hook, not in synchronize-managed schema.
