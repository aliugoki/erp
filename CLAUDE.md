# CLAUDE.md — MetaXperts ERP Constitution

> This file is the agent's constitution. It is read in the **PRE-FLIGHT** of every build chunk so a
> fresh session never reinvents patterns. The authoritative build process lives in
> `MetaXperts-ERP-Build-Chain-v2.md`; the binding cross-cutting decisions live in `docs/adr/`.
> When this file and a chunk prompt disagree, **the ADRs win** — and if an ADR is wrong, supersede it
> with a new ADR, never by silently drifting.

---

## 1. Architecture Overview & Runtime Map

MetaXperts ERP is a **multi-tenant, event-driven** ERP. It is a pnpm monorepo with four runnable
apps and two shared packages.

| Path | Runtime | Responsibility |
|---|---|---|
| `apps/api` | **NestJS** (TS strict, Node 22) | The HTTP API and the home of all business modules. Owns the database, tenancy, auth, and the transactional outbox writer. |
| `apps/web` | **Next.js 14** | The dashboard / UI. |
| `apps/ml` | **Python FastAPI** | ML/AI service (forecasting, anomaly detection, OCR, semantic search). The one justified polyglot exception (ADR-001). |
| `apps/worker` | **NestJS standalone + BullMQ** | Consumes domain events and runs business reactions (PO suggestions, balance updates, commissions). Go is introduced **only** on a measured throughput need (ADR-001, decision gate in chunk 4.4). |
| `packages/shared` | TS library | Cross-app contracts: success/error envelopes, `Money`, pagination meta, **versioned event contracts**. |
| `packages/config` | TS library | Env schema (zod/Joi) validated and consumed by `api` + `worker`. |
| `infra/` | Docker Compose | Postgres 16, PgBouncer, Redis 7, RabbitMQ, MinIO, OTel Collector, Prometheus, Grafana. |

**Data flow:** request → API (auth + tenant scope set on the DB connection) → business write **and**
outbox row in one DB transaction → OutboxRelay publishes to RabbitMQ → idempotent worker consumers
react → notifications / realtime / read-model updates. OpenTelemetry trace context propagates across
every hop (API → broker → worker → ML).

---

## 2. The Chunk Contract (the unit of work)

Every chunk is one Claude Code session and obeys this five-part contract. **Do not deviate.**

1. **OBJECTIVE** — one sentence; what "done" means.
2. **PRE-FLIGHT** — read this `CLAUDE.md` + the relevant ADRs + the chunk's dependencies before
   writing any code. Architecture/security/reliability chunks enter **plan mode** first.
3. **BUILD** — the concrete tasks.
4. **GATE** — machine-checkable acceptance criteria. The session is **not done** until every gate
   command exits 0. No "should work."
5. **CHECKPOINT** — one commit + one immutable `ckpt/<phase>.<chunk>-stable` git tag.

If a gate fails and cannot be fixed within the session, **revert to the last checkpoint tag** and
re-run the chunk with a tightened prompt. Never push forward on a red gate. Keep
`CHANGELOG-BUILD.md` updated (one line per chunk: what changed, what the gate proved).

---

## 3. Coding Conventions

### NestJS module structure
Each business module is one folder:
`entities/  dto/  <name>.module.ts  <name>.service.ts  <name>.controller.ts  <name>.service.spec.ts`.
Use the **module-scaffold** skill to stamp this so Phase 3 chunks stay short.

### DTOs & validation
- Every request body/query is a DTO class validated with **class-validator**.
- The global `ValidationPipe` runs with `whitelist: true` **and** `forbidNonWhitelisted: true`
  (unknown fields are rejected, never silently dropped). Transform enabled.

### Success envelope
All successful responses are wrapped by a global interceptor as:
```jsonc
{ "data": <payload>, "meta": { /* pagination, etc. when relevant */ } }
```
Lists return pagination in `meta` (`page`, `pageSize`, `total`, `totalPages`).

### Error envelope
All errors are **RFC 7807** `application/problem+json`:
```jsonc
{ "type": "about:blank", "title": "...", "status": 400, "detail": "...", "instance": "/path", "traceId": "..." }
```
A global exception filter produces this; never leak stack traces or raw DB errors to clients.

### Money
**Integer minor units + ISO-4217 currency code. Never floats.** `Money = { amountMinor: number, currency: string }`.
All arithmetic on integers; format only at the edge (UI/serialization). PKR is the default currency,
currency-configurable (ADR-007).

### Tenant scoping (non-negotiable)
**Every** business query is tenant-scoped, enforced at two layers (ADR-002, ADR-005):
- App layer: all business entities extend `BaseEntity` and go through the **tenant-scoped repository**,
  which injects `tenant_id` automatically.
- DB layer: **Postgres Row-Level Security** keyed off a per-request session variable
  (`app.tenant_id`). Even a forgotten `WHERE` cannot leak across tenants.

### Other
- Times are UTC `timestamptz`. IDs are UUIDs. Soft delete via `@DeleteDateColumn` (`deleted_at`).
- Logs are structured JSON carrying `traceId`, `tenantId`, `userId`, `requestId` (ADR-007).
- Public routes are an explicit allowlist (`/health*`, `/auth/*`); everything else is guarded.

---

## 4. Global Definition of Done (every chunk, no exceptions)

On top of chunk-specific gate checks, a chunk is done only when:

```bash
pnpm -w typecheck          # tsc strict, zero errors
pnpm -w lint               # zero errors
pnpm -w test               # unit tests for touched code green
```
Plus:
- **New entity?** → a reviewed TypeORM migration exists and `migration:run` is **idempotent**
  (run twice; the second run is a no-op). `synchronize` is never used.
- **New endpoint?** → it is guarded (auth + tenant scope) **or** explicitly on the public allowlist.
- **New external call?** (DB / Redis / broker / SMTP / ML / S3) → it has a **timeout + retry/backoff +
  a failure path** (and a circuit breaker where a remote is involved).
- **New domain side-effect?** → emitted via the **transactional outbox**, never an inline `publish()`.
- `CLAUDE.md` + `CHANGELOG-BUILD.md` updated; commit + `ckpt/<phase>.<chunk>-stable` tag created.

---

## 5. The Three Nevers

1. **Never use `synchronize`.** Every schema change is a reviewed, idempotent, reversible migration
   (ADR-003).
2. **Never publish an event outside the outbox.** Business change + outbox row commit in the same DB
   transaction; a relay publishes (ADR-004).
3. **Never add a business query without tenant scope.** Scoped repo + Postgres RLS, always
   (ADR-002, ADR-005).

---

## 6. Architecture Decision Records

The binding decisions live in [`docs/adr/`](docs/adr/) and are referenced in each chunk's PRE-FLIGHT:

- **ADR-001** — Stack & polyglot scope (single-runtime core; Go only on measured need).
- **ADR-002** — Multi-tenancy (shared schema + `tenant_id` + Postgres RLS).
- **ADR-003** — Persistence & migrations (`synchronize: false`; reviewed idempotent migrations).
- **ADR-004** — Reliable eventing (transactional outbox + idempotent consumers + retry/backoff/DLQ).
- **ADR-005** — Cross-cutting base (`BaseEntity` + tenant-scoped base repository).
- **ADR-006** — Security boundaries (authN/Z + tenant scoping before any module; signed service auth).
- **ADR-007** — Observability & money (OTel trace propagation; money as integer minor units).
- **ADR-008** — UI/UX stack (Next.js + Tailwind + shadcn/ui + next-themes; enterprise, open-source, multi-theme).
- **ADR-009** — Per-tenant feature entitlements (module registry + entitlements table + `FeatureGuard`; companies add/remove features).

**Two more Nevers (product constraints):** Never add a paid/closed-source dependency — open-source,
self-hostable tooling only. Never gate a feature in the UI alone — the backend `FeatureGuard` is
authoritative (ADR-009).

---

## 7. Tooling & Subagents

- **Hooks** (`.claude/settings.json`): `PreToolUse` secret-scan blocks writes containing secrets;
  `PostToolUse` typecheck advisory on edited files. Things that *must always run* go in hooks.
- **Subagents** (`.claude/agents/`): `explorer` (read-only repo mapper, run in PRE-FLIGHT),
  `reviewer` (diff auditor against this file — run before every CHECKPOINT), `test-writer`
  (`*.spec.ts` generator).
- **Models per phase** (switch with `/model`): Opus for architecture/security/reliability/sagas,
  Sonnet for implementation/CRUD, Haiku for scaffolding. Use `opusplan` for Phases 2/4/7.
- Prefer ending a chunk at its gate over `/compact`. A clean session beats a compacted one.

---

## 8. Production & Operations (Phase 9)

The whole system runs in containers via **`infra/docker-compose.prod.yml`** (per-app multi-stage,
distroless, non-root images — Chunk 9.1). Apps reach Postgres **through PgBouncer as `app_user`**
(RLS enforced); migrations/relay use the owner connection. Health: `/health` (liveness),
`/health/ready` (Postgres+Redis, drains on shutdown), `/metrics` (Prometheus RED+USE).

- **Deploy / migrate / seed:** `docker compose -f infra/docker-compose.prod.yml up -d --build`, then
  `pnpm --filter @app/api migration:run` (idempotent), then `infra/scripts/seed-demo.sh` (idempotent
  demo tenant + data across all modules). Secrets via a store or the `*_FILE` convention.
- **Backups:** `infra/scripts/backup.sh` (pg_dump custom format, optional S3/MinIO) +
  `restore.sh`. Test restores into a scratch DB.
- **CI/CD:** `.github/workflows/ci.yml` (typecheck/lint/unit + e2e against infra + advisory headless
  `claude -p` review) and `security.yml` (pnpm audit + Trivy + pip-audit) run on every PR;
  `deploy-staging.yml` builds/pushes images to GHCR and canary-deploys with health-gated rollback.
- **Runbook:** `docs/runbook.md` — deploy, rolling restart (zero in-flight loss via the outbox),
  rollback, alerts→actions, DLQ drain, graceful-degradation expectations, scaling.
- **Acceptance:** `infra/scripts/acceptance.sh` drives every module, fires each domain event, asserts
  the relay published them + consumers reacted, and proves ML-down graceful degradation.

**Finance is now a full accounting suite** (post-9.1 feature work, not a build-chain chunk): 4-level
chart of accounts, voucher types (BRV/BPV/CPV/CRV/JV) with numbering + cash/bank validation,
maker/checker posting workflow, GL + Trial Balance + Balance Sheet + Income Statement + Cash Flow,
cash book, fiscal periods + locking, voucher reversal, bank reconciliation + statement auto-match,
AR + AP with aging, cost-center dimensions, budgets vs actual, year-end close, recurring vouchers, and
multi-currency. All under the same conventions (RLS, integer minor units, raw SQL via the
tenant-scoped tx, reviewed idempotent migrations).
