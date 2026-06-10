# ADR-001 — Stack & Polyglot Scope

**Status:** Accepted · **Date:** 2026-06-10 · **Deciders:** MetaXperts engineering

## Context

The ERP needs a backend API, a web dashboard, an ML/AI service, and a background worker for event-driven reactions (purchase-order suggestions, balance updates, commission calculation). A naive "world-class" instinct is to reach for a polyglot stack — NestJS + a Go worker + Python ML — because it looks impressive. But every additional runtime multiplies the build, deploy, dependency, and observability surface, and splits the team's mental model. Go is justified only where there is a *measured* throughput or latency need that a Node-based queue cannot meet. The worker's known jobs are not obviously hot paths.

## Decision

The core runtime is **single-language where practical**:

- `apps/api` — **NestJS** (TypeScript, strict), Node 22 LTS.
- `apps/web` — **Next.js 14**.
- `apps/ml` — **Python FastAPI**, justified by the ML/AI library ecosystem (Prophet, scikit-learn, sentence-transformers, OCR). This is the one polyglot exception and it earns its place.
- `apps/worker` — **NestJS + BullMQ**, in-repo, sharing types with the API. **Not Go.**

A separate **Go worker is introduced only if** the Phase 4 load test (chunk 4.4) shows BullMQ cannot sustain the target throughput within SLO. That decision, with the measured numbers, is recorded back into this ADR before any Go code is written.

Monorepo: **pnpm workspaces**. Shared contracts live in `packages/shared`; env/config schema in `packages/config`.

## Consequences

- One language (TypeScript) across API, worker, web, and shared contracts → shared DTOs/events, one toolchain, one CI lane for the JS side.
- ML isolation is deliberate and contract-bound (see ADR-006 for its auth, ADR-004 for how it's reached).
- Adding Go later is a conscious, evidence-backed step — not a day-one tax.
- Risk accepted: BullMQ/Redis becomes a load-bearing dependency for background work; mitigated by the resilience work in Phase 7 (bounded retries, DLQ, backpressure).

## Decision gate (chunk 4.4)

> Publish ~10k `inventory.low_stock` events under load. If BullMQ sustains the target rate within SLO → **stay NestJS**, record the numbers here. Only on failure → open a follow-up chunk to port the specific hot handler to Go. Do **not** introduce Go speculatively.
