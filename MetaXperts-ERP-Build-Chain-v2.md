# MetaXperts ERP — Enterprise Build Chain for Claude Code

> **Version 2.0** — rebuilt for session-sized chunks, fault tolerance (of both the build process and the running system), and the current paid Claude Code (v2.1.154+, Opus 4.8 / Sonnet 4.6 / Haiku 4.5).
>
> This is an **operating manual**, not just a prompt list. Read Section 0 once before you start. Each chunk is one Claude Code session that ends in a passing gate, a commit, and a checkpoint tag. Never start a chunk before the previous chunk's gate is green.

---

## 0. Operating Manual — Read This First

### 0.1 Prerequisites (verify before Phase 0)

```bash
claude update                 # need v2.1.154+ for Opus 4.8
claude --version
node -v                       # Node 22 LTS
docker --version && docker compose version
git --version
pnpm -v                       # corepack enable; corepack prepare pnpm@latest --activate
```

Install Claude Code (native binary is the current recommended channel):

```bash
curl -fsSL https://claude.ai/install.sh | bash
# macOS alt: brew install --cask claude-code
```

Paid tier: any plan that includes Claude Code (Pro / Max / Team / Enterprise) or API billing. Max/Team-Premium default to Opus; Pro/Team-Standard default to Sonnet. This chain assumes you can reach **Opus 4.8** for architecture chunks.

### 0.2 The Chunk Contract (the unit of work)

Every chunk in this document obeys the same five-part contract. **Do not deviate.**

1. **OBJECTIVE** — one sentence; what "done" means.
2. **PRE-FLIGHT** — what Claude Code must read and verify before writing code (always `CLAUDE.md` + the relevant ADRs + the chunk's dependencies).
3. **BUILD** — the concrete tasks.
4. **GATE** — machine-checkable acceptance criteria. The session is **not done** until every gate command exits 0. No "should work."
5. **CHECKPOINT** — commit message + git tag. This is your rollback anchor.

If a gate fails and cannot be fixed within the session, **revert to the last checkpoint tag** and re-run the chunk with a tightened prompt. Never push forward on a red gate — that is how a single bad chunk poisons three good ones.

### 0.3 Git & Checkpoint Discipline (build-process fault tolerance)

```bash
# one branch per phase
git switch -c phase/3-core-modules

# at the end of EVERY chunk:
git add -A
git commit -m "feat(hr): employees + departments, tenant-scoped, tests green"
git tag ckpt/3.1-hr-stable        # immutable rollback anchor

# recover from a bad chunk:
git reset --hard ckpt/3.0-stable  # last good tag
```

Rules:
- One commit + one `ckpt/<phase>.<chunk>-stable` tag per chunk. Tags are the contract; branches are disposable.
- Never squash away a checkpoint until the whole phase passes its end gate.
- Keep a `CHANGELOG-BUILD.md` updated by the final task of each chunk (one line: what changed, what the gate proved).

### 0.4 How This Chain Uses Current Claude Code Features

| Feature | Where used | Why |
|---|---|---|
| **`CLAUDE.md`** | Created in 0.1, updated by every chunk | The agent's constitution — carries decisions forward so a fresh session never reinvents patterns. Single biggest lever for consistency. |
| **Plan mode** (`shift+tab` to enter, or launch `--permission-mode plan`) | All architecture chunks (Phase 1, 2, 4, 7) | Forces a written plan + repo exploration before any edit. Review the plan, then approve. |
| **Subagents** (`/agents`) | Exploration & review on every chunk | Fork an **Explore** agent to map the repo and a custom **reviewer** agent to audit the diff — keeps the main context clean and prevents drift. Defined in `.claude/agents/` (see Appendix C). |
| **Hooks** (`.claude/settings.json`) | Always-on gates | `PreToolUse` secret-scan before any write; `PostToolUse` runs typecheck/lint on edited files. Things that *must always run* go in hooks, not prompts. |
| **Skills** (`.claude/skills/<name>/SKILL.md`) | Repeatable patterns | Encode the outbox pattern, the module scaffold, and the verification-gate checklist once; invoke everywhere. |
| **`opusplan` mode** | Phases 2, 4, 7 | Plan/reason with Opus, execute with Sonnet — quality where it matters, speed/cost where it doesn't. |
| **Headless** (`claude -p`) | CI (Phase 9) | Automated code review and migration-sanity checks in GitHub Actions. |
| **`/compact`** | Mid-chunk only as a last resort | If context bloats, `/compact` — but prefer ending the chunk at its gate and starting fresh. A clean session beats a compacted one. |

### 0.5 Global Definition of Done (every chunk, no exceptions)

A chunk's GATE always includes these, on top of chunk-specific checks:

```bash
pnpm -w typecheck          # tsc --noEmit, strict, zero errors
pnpm -w lint               # zero errors
pnpm -w test               # unit tests for touched code green
# new entity? -> a migration exists and `migration:run` is idempotent (run twice, second is a no-op)
# new endpoint? -> it is guarded (auth + tenant scope) OR explicitly on the public allowlist
# new external call? -> it has a timeout + retry/backoff + a failure path
```

### 0.6 Recovery Playbook (when Claude Code gets stuck)

| Symptom | Action |
|---|---|
| Plan looks wrong / over-scoped | Reject the plan, narrow the prompt to a single deliverable, re-enter plan mode. |
| Context bloated, answers getting shallow | End at the nearest sub-task boundary, commit WIP to a `wip/` tag, start a fresh session, point it at `CLAUDE.md` + WIP tag. |
| Gate fails repeatedly on the same thing | `git reset --hard` to last `ckpt`, then run the chunk with the failing check stated up front as the first task. |
| Drifted from conventions | Run the **reviewer** subagent against the diff; feed its findings back as the next instruction. |
| Migration history corrupted | Never hand-edit applied migrations. Generate a new corrective migration; if pre-prod, reset DB + re-run from clean and re-seed. |
| Mysterious runtime crash (segfault/native) | Isolate: reproduce in a minimal harness, bisect by checkpoint tag, do **not** rebuild base images blindly (ABI drift). Defer with a documented `deferred/` note and keep shipping the stable path. |

---

## 1. Architecture Decision Records — Lock Before Building

These are committed as `docs/adr/*.md` in Phase 0 and referenced in every chunk's PRE-FLIGHT. They exist so cross-cutting choices are made **once, up front** — the original chain's fatal flaw was retrofitting tenancy and security after the modules were built.

- **ADR-001 — Stack & polyglot scope.** Default to a **single-runtime** core: NestJS (API) + Next.js (web) + Python FastAPI (ML, justified by the ML library ecosystem). The background worker starts as a **NestJS + BullMQ** process *in-repo*, **not** Go. A separate Go worker is introduced **only** if Phase 4's load test shows a sustained throughput need BullMQ cannot meet. Rationale: three runtimes triple the build/deploy/observability surface; pay that cost only against measured need. (Decision gate lives in chunk 4.4.)
- **ADR-002 — Multi-tenancy.** Shared schema, `tenant_id UUID NOT NULL` on every business table, enforced by **PostgreSQL Row-Level Security (RLS)** keyed off a per-request session variable — *not* by application code alone. Defense in depth: even a forgotten `WHERE` cannot leak across tenants. Established in the foundation (chunk 1.4), before any module exists.
- **ADR-003 — Persistence & migrations.** `synchronize: false` from the first entity. **Every** schema change is a reviewed TypeORM migration. Migrations must be idempotent and reversible. No exceptions, no "we'll write them at the end."
- **ADR-004 — Reliable eventing.** Events are published via the **transactional outbox** pattern (write event + business change in one DB transaction; a relay polls and publishes). Consumers are **idempotent** (dedupe on event id) and protected by **retry-with-backoff → dead-letter queue**. No event is ever published in the same breath as an un-committed write.
- **ADR-005 — Cross-cutting base.** A `BaseEntity` (uuid id, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`) and a tenant-scoped base repository are defined in the kernel and inherited by every entity. Soft delete and audit columns are never per-module decisions.
- **ADR-006 — Security boundaries.** AuthN/Z and tenant scoping exist *before* the first business module. Service-to-service calls (API↔ML) are authenticated from day one (signed service token / mTLS), never "secured later."
- **ADR-007 — Observability & money.** OpenTelemetry trace context propagates across API↔broker↔worker↔ML. Logs are structured JSON carrying `traceId`/`tenantId`/`userId`. **Money is stored as integer minor units + ISO currency code** (never floats); PKR-first, currency-configurable.

---

## 2. The Build Chain

> Model legend per chunk: **[Opus]** architecture/security/reliability · **[Sonnet]** implementation · **[Haiku]** mechanical scaffolding & subagents. Switch with `/model` or launch with `--model`. Use `opusplan` where noted.

---

### PHASE 0 — Genesis

#### Chunk 0.1 — Repo, tooling, constitution, ADRs  **[Opus, plan mode]**

```
You are bootstrapping a production-grade ERP for MetaXperts. Do ONLY this chunk.

OBJECTIVE: An empty-but-governed monorepo with the constitution and decisions written down. No business code.

PRE-FLIGHT: Enter plan mode. Propose the plan and wait for approval before writing.

BUILD:
1. Initialize git + pnpm workspaces. Create the workspace layout:
   apps/{api,web,ml,worker}  packages/{shared,config}  docs/adr  infra
2. Write CLAUDE.md (the agent constitution). It MUST contain:
   - Architecture overview and the runtime map
   - The Chunk Contract (objective/preflight/build/gate/checkpoint)
   - Coding conventions: NestJS module structure, DTO+class-validator rules,
     { data, meta } success envelope, RFC 7807 problem+json errors,
     money-as-integer-minor-units, tenant-scoping requirement on every query
   - The Global Definition of Done (typecheck/lint/test/migration/guard/resilience)
   - "Never use synchronize. Never publish an event outside the outbox.
     Never add a business query without tenant scope."
3. Write docs/adr/ADR-001..007 capturing the seven decisions provided to you below.
   [paste ADR-001..007 text from Section 1 of the build chain doc]
4. Configure tooling: root tsconfig.json (strict, path aliases @app/*, @shared/*),
   eslint + prettier, husky/lint-staged OR rely on Claude Code hooks (set up .claude/settings.json
   with a PreToolUse secret-scan hook and a PostToolUse typecheck-on-edit hook — see Appendix B).
5. Create .claude/agents/ with: explorer (read-only repo mapper), reviewer (diff auditor),
   test-writer (spec generator). Definitions in Appendix C.
6. Create CHANGELOG-BUILD.md with the first line for this chunk.
7. .env.example with every variable the stack will need (DB, Redis, RabbitMQ, JWT secrets,
   service tokens, OTel endpoint, S3/MinIO).

GATE:
  pnpm -w typecheck   # passes on empty workspace
  test -f CLAUDE.md && test -d docs/adr && ls docs/adr | wc -l   # == 7
  cat .claude/settings.json  # hooks present
CHECKPOINT: commit "chore: monorepo genesis + constitution + ADRs"; tag ckpt/0.1-genesis-stable
```

---

### PHASE 1 — Platform Foundation

#### Chunk 1.1 — Monorepo scaffold + shared package  **[Sonnet]**

```
Read CLAUDE.md and ADR-005, ADR-007.

OBJECTIVE: Compiling skeletons for all apps + a shared package that owns cross-app contracts.

BUILD:
1. apps/api: NestJS app (TS strict), boots, GET /health -> 200 { data:{ status:'ok' } }.
2. apps/web: Next.js 14 app, builds, renders a placeholder dashboard shell.
3. apps/ml: FastAPI app, GET /health -> 200.
4. apps/worker: NestJS standalone app (BullMQ-ready), GET /worker/health -> 200.
5. packages/shared: success envelope type, problem+json error type, Money type
   (amountMinor:number, currency:string), pagination meta, base event contract shape.
6. packages/config: env schema with Joi/zod, exported and consumed by api + worker.

GATE: pnpm -w build (all 4 apps compile) && pnpm -w typecheck && pnpm -w lint
CHECKPOINT: "feat: app skeletons + shared contracts"; tag ckpt/1.1-skeleton-stable
```

#### Chunk 1.2 — Local infrastructure  **[Haiku]**

```
Read CLAUDE.md.

OBJECTIVE: A reproducible local stack the API can actually connect to.

BUILD:
1. infra/docker-compose.yml: postgres:16, pgbouncer (transaction pool mode),
   redis:7, rabbitmq:3-management, minio, otel-collector, prometheus, grafana.
2. Healthchecks + named volumes + a single docker network for every service.
3. Make targets / pnpm scripts: `infra:up`, `infra:down`, `infra:logs`, `infra:reset`.
4. Wire apps/api DB connection THROUGH pgbouncer, Redis for cache/queues.

GATE:
  docker compose -f infra/docker-compose.yml up -d
  # wait for healthy, then:
  curl -fsS localhost:3000/health        # api 200 (db reachable via pgbouncer)
  docker compose ps                       # all services healthy
CHECKPOINT: "feat: local infra (pg/pgbouncer/redis/rabbitmq/minio/otel)"; tag ckpt/1.2-infra-stable
```

#### Chunk 1.3 — NestJS kernel  **[Opus, plan mode]**

```
Read CLAUDE.md, ADR-003, ADR-007. Enter plan mode; get plan approved.

OBJECTIVE: The API kernel every module will sit on. No business logic.

BUILD:
1. ConfigModule with Joi validation (fail fast on bad env).
2. DatabaseModule: TypeORM + pg, synchronize:false, migrations wired, datasource for CLI.
3. Global: validation pipe (whitelist+forbidNonWhitelisted), exception filter emitting
   RFC 7807 problem+json, response interceptor wrapping success in { data, meta }.
4. Structured JSON logger (pino/winston) with a request-scoped logger carrying a requestId.
5. RequestContext via AsyncLocalStorage (will later hold tenantId + userId).
6. Health module: /health (liveness) and /health/ready (readiness: checks DB + Redis).
7. Graceful shutdown hooks (drain in-flight before exit).

GATE:
  pnpm -w typecheck && pnpm -w lint
  curl -fsS localhost:3000/health/ready   # 200 only when db+redis up; 503 when down (test both)
  # bad env var -> app refuses to boot (fail fast)
CHECKPOINT: "feat: api kernel (config/db/errors/logging/health/shutdown)"; tag ckpt/1.3-kernel-stable
```

#### Chunk 1.4 — Cross-cutting tenancy kernel (the keystone)  **[Opus, plan mode]**

```
Read CLAUDE.md, ADR-002, ADR-005. Enter plan mode; get plan approved.
This chunk MUST land before any business module. Take it slowly.

OBJECTIVE: Tenant isolation enforced at the DATABASE, plus the shared BaseEntity + scoped repo.

BUILD:
1. abstract BaseEntity: id (uuid), tenantId (uuid, not null), createdAt, updatedAt,
   deletedAt (soft delete via @DeleteDateColumn), createdBy, updatedBy.
2. TenantContext: read tenantId from RequestContext (AsyncLocalStorage).
3. A TenantScopedRepository base that auto-injects tenantId into every find/save/update.
4. POSTGRES RLS — this is the defense-in-depth layer:
   - migration: enable RLS on a sample tenant-owned table; policy USING
     (tenant_id = current_setting('app.tenant_id')::uuid).
   - a TypeORM subscriber / connection hook that SETs app.tenant_id per request
     from RequestContext, and resets it.
   - prove that without the session var set, a tenant-scoped query returns ZERO rows.
5. Migration generation/run scripts; confirm `migration:run` is idempotent.

GATE:
  # write an integration test that:
  #  - creates rows for tenant A and tenant B
  #  - sets app.tenant_id = A, queries -> sees ONLY A's rows
  #  - sets app.tenant_id = B, queries -> sees ONLY B's rows
  #  - sets no tenant -> sees ZERO rows (RLS denies)
  pnpm -w test -- tenancy
  pnpm -w typecheck && pnpm -w lint
CHECKPOINT: "feat: tenancy kernel (BaseEntity + scoped repo + Postgres RLS)"; tag ckpt/1.4-tenancy-stable
```

---

### PHASE 2 — Identity, Tenancy & Security Core  *(moved ahead of modules — see ADR-006)*

#### Chunk 2.1 — Authentication  **[Opus, opusplan]**

```
Read CLAUDE.md, ADR-006. Plan, then execute.

OBJECTIVE: Secure login with rotating refresh tokens.

BUILD:
1. AuthModule: POST /auth/login, /auth/refresh, /auth/logout.
2. Access JWT (15m) + refresh token (7d) WITH ROTATION (old refresh invalidated on use;
   reuse detection -> revoke the whole token family).
3. Password hashing: argon2id (preferred) or bcrypt cost 12.
4. Refresh tokens stored in Redis with TTL + family id for reuse detection.
5. /auth/* on the public allowlist; everything else will require auth.

GATE: e2e: login -> refresh -> old refresh now rejected (rotation) -> logout -> refresh rejected.
  pnpm -w test:e2e -- auth
CHECKPOINT: "feat: auth (jwt + rotating refresh + reuse detection)"; tag ckpt/2.1-auth-stable
```

#### Chunk 2.2 — Users + RBAC  **[Opus, opusplan]**

```
Read CLAUDE.md, ADR-006.

OBJECTIVE: Users, roles, permissions, and guards ready to protect modules.

BUILD:
1. User entity (extends BaseEntity): email, passwordHash, employeeId (nullable),
   roles[], isActive, lastLoginAt.
2. Roles: SUPER_ADMIN, TENANT_ADMIN, HR_MANAGER, FINANCE_MANAGER,
   INVENTORY_MANAGER, SALES_REP, VIEWER.
3. @Roles() decorator + RolesGuard; @Permissions() decorator + PermissionsGuard
   (fine-grained, e.g. finance:invoice:write).
4. Register guards globally; explicit @Public() allowlist for /health* and /auth/*.

GATE: e2e: VIEWER blocked from a write route (403); proper role allowed (200);
  unauthenticated request to any non-public route -> 401.
  pnpm -w test:e2e -- rbac
CHECKPOINT: "feat: users + RBAC (roles + permissions + global guards)"; tag ckpt/2.2-rbac-stable
```

#### Chunk 2.3 — Tenant provisioning + request scoping  **[Opus]**

```
Read CLAUDE.md, ADR-002, ADR-006.

OBJECTIVE: Tenants are first-class; every request is bound to exactly one tenant.

BUILD:
1. Tenant entity + provisioning: POST /tenants (SUPER_ADMIN only) creates tenant + first TENANT_ADMIN.
2. TenantInterceptor: extract tenantId from the JWT, push into RequestContext,
   which sets app.tenant_id (RLS) for the connection. Reject tokens with no tenant.
3. Cross-tenant access attempt by a valid user of tenant A against tenant B data -> 403/empty by RLS.

GATE: e2e cross-tenant isolation:
  user of tenant A authenticated, requests a resource id belonging to tenant B -> not found/forbidden.
  pnpm -w test:e2e -- tenant-isolation
CHECKPOINT: "feat: tenant provisioning + per-request scoping wired to RLS"; tag ckpt/2.3-tenants-stable
```

#### Chunk 2.4 — Audit log + service-to-service auth  **[Opus]**

```
Read CLAUDE.md, ADR-006.

OBJECTIVE: Tamper-evident audit trail + authenticated internal calls.

BUILD:
1. AuditLog entity: userId, tenantId, action, resource, resourceId,
   oldValue JSONB, newValue JSONB, ipAddress, traceId, timestamp.
2. AuditInterceptor: auto-log every POST/PATCH/DELETE with before/after diff.
3. Service auth: signed short-lived service token (or mTLS) for API->ML and API->worker;
   a ServiceAuthGuard for internal-only endpoints. The ML bridge built in Phase 6
   will REQUIRE this — never an unauthenticated internal hop.

GATE: e2e: a mutation writes an audit row with correct old/new; an internal endpoint
  rejects a request lacking the service token (401).
  pnpm -w test:e2e -- audit service-auth
CHECKPOINT: "feat: audit interceptor + service-to-service auth"; tag ckpt/2.4-security-stable
# PHASE 2 END GATE: no unguarded routes except the public allowlist; isolation + audit proven.
```

---

### PHASE 3 — Core Business Modules  *(one module = one chunk; tenant-scoped from birth)*

> Each module uses the same scaffold: `entities/ dto/ *.module.ts *.service.ts *.controller.ts *.service.spec.ts`. All entities extend `BaseEntity`. All queries go through the tenant-scoped repo. Use the **module scaffold skill** (Appendix C) to avoid repeating boilerplate.

#### Chunk 3.1 — HR  **[Sonnet]**

```
Read CLAUDE.md. Use the module-scaffold skill.

OBJECTIVE: HR module (employees, departments, positions, attendance), tenant-scoped, tested.

BUILD:
- Employee(extends BaseEntity): employeeCode, firstName, lastName, email, phone,
  departmentId, positionId, joinDate, salary(Money), status.
- Department: name, managerId, parentDepartmentId (self-ref tree).
- Position, Attendance entities.
- CRUD for all; GET /hr/employees?department=&status=&search= (paginated { data, meta }).
- Guards: HR_MANAGER write, VIEWER read.
- Seed: Pakistani names, PKR salaries, realistic departments.

GATE: service unit tests green; e2e list+filter+pagination; tenant scope verified on every query.
  pnpm -w test -- hr && pnpm -w test:e2e -- hr
CHECKPOINT: "feat(hr): employees/departments/positions/attendance"; tag ckpt/3.1-hr-stable
```

#### Chunk 3.2 — Finance  **[Opus, opusplan]**  *(invariants matter here)*

```
Read CLAUDE.md, ADR-007 (money). Plan, then execute.

OBJECTIVE: Double-entry-safe finance module.

BUILD:
- ChartOfAccount: code, name, type (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE).
- Transaction + JournalEntry[]: POST /finance/transactions MUST reject unless
  sum(debits) === sum(credits) (assert on integer minor units; never floats).
- Invoice: number, clientId, lineItems, subtotal, tax, total (all Money), status, dueDate.
- GET /finance/invoices?status=&from=&to=&clientId= (paginated).
- On invoice paid -> write a `finance.invoice_paid` event TO THE OUTBOX (not yet published;
  outbox infra lands in Phase 4 — write the row, leave publishing to the relay).

GATE: unit test proves unbalanced transaction is rejected; money never represented as float anywhere.
  pnpm -w test -- finance && pnpm -w test:e2e -- finance
CHECKPOINT: "feat(finance): COA/transactions/invoices + balance invariant"; tag ckpt/3.2-finance-stable
```

#### Chunk 3.3 — Inventory  **[Sonnet]**

```
Read CLAUDE.md.

OBJECTIVE: Inventory with low-stock signalling via the outbox.

BUILD:
- Product: sku, name, category, unit, costPrice(Money), sellPrice(Money), minStock.
- Warehouse, StockMovement (type IN/OUT/TRANSFER, qty, reference).
- GET /inventory/products/low-stock (below minStock).
- On a movement that drops stock below minStock -> write `inventory.low_stock` to the OUTBOX.

GATE: low-stock query correct; outbox row written transactionally with the movement
  (same DB transaction — assert atomicity: movement rolled back => no outbox row).
  pnpm -w test -- inventory && pnpm -w test:e2e -- inventory
CHECKPOINT: "feat(inventory): products/warehouses/movements + low-stock outbox"; tag ckpt/3.3-inventory-stable
```

#### Chunk 3.4 — CRM  **[Sonnet]**

```
Read CLAUDE.md.

OBJECTIVE: CRM with a pipeline view.

BUILD:
- Client: companyName, industry, website, status.
- Contact: clientId, name, email, phone, isPrimary.
- Deal: clientId, title, value(Money), stage, expectedCloseDate, assignedTo.
- GET /crm/deals/pipeline (grouped by stage, totals as Money).
- On deal stage -> CLOSED_WON: write `crm.deal_closed` to the OUTBOX.

GATE: pipeline grouping + totals correct; outbox row on close.
  pnpm -w test -- crm && pnpm -w test:e2e -- crm
CHECKPOINT: "feat(crm): clients/contacts/deals + pipeline + close outbox"; tag ckpt/3.4-crm-stable
# PHASE 3 END GATE: all four modules, all tenant-scoped, all writing domain events to the outbox.
```

---

### PHASE 4 — Reliable Event Backbone

#### Chunk 4.1 — Transactional outbox + relay  **[Opus, plan mode]**

```
Read CLAUDE.md, ADR-004. Plan, then execute. Use the outbox skill (Appendix C).

OBJECTIVE: Events written in Phase 3 actually get published — exactly once, reliably.

BUILD:
1. outbox_event table: id, tenantId, type, payload JSONB, occurredAt, publishedAt (null),
   attempts. (Already being written to by modules.)
2. OutboxRelay: a polling worker (interval + FOR UPDATE SKIP LOCKED) that publishes
   unpublished rows to the broker, marks publishedAt, increments attempts on failure.
3. Crash-safety: a publish that succeeds but dies before marking publishedAt must NOT
   double-deliver in a way consumers can't dedupe (consumers handle idempotency in 4.3).

GATE: integration test: write 100 outbox rows, run relay, all published exactly once;
  kill relay mid-batch, restart, no row lost and none double-marked.
  pnpm -w test -- outbox
CHECKPOINT: "feat: transactional outbox + relay"; tag ckpt/4.1-outbox-stable
```

#### Chunk 4.2 — Broker + EventBus + versioned contracts  **[Opus]**

```
Read CLAUDE.md, ADR-004.

OBJECTIVE: A typed publish/subscribe layer over RabbitMQ.

BUILD:
1. @nestjs/microservices + amqplib; topology: exchange per domain, durable queues.
2. EventBusModule: publish(event) / subscribe(type, handler) helpers.
3. packages/shared/events: VERSIONED contracts (inventory.low_stock.v1,
   finance.invoice_paid.v1, hr.employee_created.v1, crm.deal_closed.v1) with payload schemas.
4. OutboxRelay publishes through EventBus.

GATE: publish each contract, a test subscriber receives the typed payload; schema mismatch fails typecheck.
  pnpm -w test -- eventbus
CHECKPOINT: "feat: rabbitmq eventbus + versioned event contracts"; tag ckpt/4.2-eventbus-stable
```

#### Chunk 4.3 — Idempotent consumers + DLQ + backoff  **[Opus, plan mode]**

```
Read CLAUDE.md, ADR-004. Plan, then execute.

OBJECTIVE: Consumers that never corrupt state on redelivery and never block on poison messages.

BUILD:
1. processed_event table (consumer-side dedupe by event id). Handler checks-then-acts in a tx.
2. Retry with exponential backoff + jitter; after N attempts -> dead-letter queue.
3. Poison-message handling: malformed payload -> DLQ immediately with reason, never infinite-loop.
4. A /admin/dlq endpoint (TENANT_ADMIN) to inspect and requeue.

GATE: deliver the same event twice -> handler effect applied ONCE (idempotent);
  a handler that throws -> retried with backoff -> lands in DLQ -> visible via admin endpoint.
  pnpm -w test -- consumers dlq
CHECKPOINT: "feat: idempotent consumers + retry/backoff + DLQ"; tag ckpt/4.3-consumers-stable
```

#### Chunk 4.4 — Worker handlers + Go decision gate  **[Sonnet]**

```
Read CLAUDE.md, ADR-001.

OBJECTIVE: Business reactions to events, on the right runtime.

BUILD:
1. Implement handlers in apps/worker (NestJS + BullMQ):
   - inventory.low_stock -> create a purchase-order suggestion
   - finance.invoice_paid -> update account balances (within a tx, idempotent)
   - crm.deal_closed -> trigger commission calculation
2. GET /worker/health + /worker/health/ready.
3. DECISION GATE (ADR-001): run a load test (publish e.g. 10k low_stock events).
   - If BullMQ sustains target throughput within SLO -> STAY NestJS. Document the numbers in the ADR.
   - ONLY if it cannot -> open a follow-up chunk to port the hot handler to a Go service.
   Do NOT introduce Go speculatively.

GATE: each handler idempotent + tenant-correct under redelivery; load-test numbers recorded in ADR-001.
  pnpm -w test -- worker-handlers
CHECKPOINT: "feat: worker handlers + documented runtime decision"; tag ckpt/4.4-worker-stable
```

---

### PHASE 5 — Integrations & Experience

#### Chunk 5.1 — Notifications  **[Sonnet]**

```
Read CLAUDE.md.
OBJECTIVE: Event-driven notifications (email + in-app).
BUILD:
- Notification entity: userId, type, title, body, readAt.
- NotificationService: Nodemailer email + in-app; subscribes to domain events and emits notifications.
- GET /notifications (unread, current user) ; POST /notifications/:id/read.
- Email failures retry via the worker queue; a down SMTP server never drops the in-app notification.
GATE: a deal_closed event produces an in-app notification for the assignee; SMTP outage degrades gracefully.
  pnpm -w test -- notifications && pnpm -w test:e2e -- notifications
CHECKPOINT: "feat: event-driven notifications"; tag ckpt/5.1-notifications-stable
```

#### Chunk 5.2 — Reporting (read models)  **[Sonnet]**

```
Read CLAUDE.md.
OBJECTIVE: Reports that return raw data AND chart-ready series, tenant-scoped, fast.
BUILD:
- GET /reports/finance/profit-loss?from=&to=
- GET /reports/inventory/valuation
- GET /reports/hr/headcount
- GET /reports/crm/sales-pipeline
- Heavy aggregations served from materialized views / read models refreshed on a schedule,
  not computed inline on every request.
GATE: each report returns { raw, series }; tenant-scoped; p95 under target on seeded data.
  pnpm -w test:e2e -- reports
CHECKPOINT: "feat: reporting via read models"; tag ckpt/5.2-reports-stable
```

#### Chunk 5.3 — Realtime gateway  **[Sonnet]**

```
Read CLAUDE.md.
OBJECTIVE: Authenticated, tenant-scoped realtime updates.
BUILD:
- Socket.io gateway; authenticate the socket handshake with the JWT; join a tenant room.
- Emit on: new invoice, low-stock alert, deal stage change (fed from events, not direct coupling).
- A client of tenant A never receives tenant B's events.
GATE: e2e: unauthenticated socket rejected; tenant-room isolation verified.
  pnpm -w test:e2e -- realtime
CHECKPOINT: "feat: jwt-auth realtime gateway, tenant-scoped"; tag ckpt/5.3-realtime-stable
```

---

### PHASE 6 — AI/ML  *(apps/ml, FastAPI)*

#### Chunk 6.1 — ML service skeleton + reproducibility  **[Sonnet]**

```
Read CLAUDE.md, ADR-006 (service auth), ADR-007.
OBJECTIVE: A Dockerized, reproducible ML service with a versioned contract and service auth.
BUILD:
- FastAPI app with /health, request/response Pydantic models, structured logging + OTel.
- requirements.txt with HARD-PINNED versions (incl. heavy deps); a slim multi-stage Dockerfile.
- ServiceAuth: reject calls without the signed service token from the API.
- A typed contract package the API bridge will import.
GATE: docker build succeeds; /health 200; unauthenticated call -> 401; deps install reproducibly.
  docker build -t metaxperts-ml apps/ml && curl -fsS localhost:8000/health
CHECKPOINT: "feat(ml): service skeleton + pinned deps + service auth"; tag ckpt/6.1-ml-skeleton-stable
```

#### Chunk 6.2 — Demand forecasting (precompute, not on-request)  **[Sonnet]**

```
Read CLAUDE.md. Note the SLA reality below.
OBJECTIVE: Forecasts that are FAST to serve because they are precomputed.
BUILD:
- A scheduled job fits Prophet/ARIMA on historical StockMovement data per product/warehouse
  and writes results to a forecast table.
- POST /ml/forecast/demand { productId, warehouseId, horizon } SERVES the precomputed result
  (dates[], predicted[], lower[], upper[]); falls back to on-demand fit only if missing,
  and that path is explicitly allowed to exceed the fast-serve SLA.
GATE: served-from-cache p95 < 200ms; on-demand fallback returns a correct shape;
  document accuracy assumptions in docstrings.
  pnpm -w test -- ml-forecast   # or pytest in apps/ml
CHECKPOINT: "feat(ml): scheduled demand forecast + fast serve"; tag ckpt/6.2-forecast-stable
```

#### Chunk 6.3 — Anomaly detection  **[Sonnet]**

```
Read CLAUDE.md.
OBJECTIVE: Flag suspicious finance transactions.
BUILD:
- POST /ml/anomaly/transactions { tenantId, dateRange }: Isolation Forest over transaction amounts;
  return [{ transactionId, score, isAnomaly, reason }].
GATE: synthetic outliers are flagged; tenant scope honored.
CHECKPOINT: "feat(ml): transaction anomaly detection"; tag ckpt/6.3-anomaly-stable
```

#### Chunk 6.4 — Invoice OCR + semantic search (pgvector)  **[Sonnet]**

```
Read CLAUDE.md.
OBJECTIVE: Extraction + real semantic search backed by a vector store.
BUILD:
- POST /ml/extract/invoice (multipart): pdfplumber/pytesseract -> { vendor, date, lineItems[], total, taxAmount }.
- POST /ml/search { query, module, tenantId }: embed with sentence-transformers, store/query
  embeddings in PGVECTOR (not an in-memory index); return top-10 with scores, tenant-scoped.
GATE: extraction returns the contract shape on a sample invoice; search returns ranked, tenant-scoped hits.
CHECKPOINT: "feat(ml): invoice OCR + pgvector semantic search"; tag ckpt/6.4-ml-features-stable
```

#### Chunk 6.5 — API ↔ ML bridge (resilient)  **[Opus]**

```
Read CLAUDE.md, ADR-006. 
OBJECTIVE: The NestJS bridge to ML, built to fail safely.
BUILD:
- MlService in apps/api calling apps/ml over HTTP WITH: service token, timeout,
  retry-with-backoff, and a circuit breaker (open -> serve cached/last-known or a typed degraded response).
- Endpoints: POST /api/ai/forecast/:productId, /api/ai/anomalies/scan, /api/ai/invoice/extract.
- Cache forecast responses in Redis (TTL 1h). ML being DOWN must NOT take the API down.
GATE: with ML stopped, the bridge returns a graceful degraded response (not a 500 cascade);
  circuit opens after threshold, half-opens after cooldown.
  pnpm -w test -- ml-bridge
CHECKPOINT: "feat: resilient api<->ml bridge (timeout/retry/breaker/cache)"; tag ckpt/6.5-bridge-stable
```

---

### PHASE 7 — Resilience & Fault Tolerance Hardening

> This phase makes the *running system* fault tolerant. Treat it as architecture: **[Opus]** throughout, plan mode on each chunk.

#### Chunk 7.1 — Timeouts, retries, breakers, bulkheads  **[Opus, plan mode]**

```
Read CLAUDE.md, ADR-004.
OBJECTIVE: No unbounded waits anywhere; no single dependency can sink the process.
BUILD:
- Audit every outbound call (DB, Redis, broker, SMTP, ML, S3). Each gets: timeout,
  bounded retry + backoff + jitter, and a circuit breaker where a remote is involved.
- Bulkhead: separate connection pools / concurrency limits per dependency so one slow
  dependency can't starve the others.
GATE: a fault-injection test (latency + errors on each dependency) shows bounded failure,
  not cascade; the process stays responsive on /health/ready.
CHECKPOINT: "feat: timeouts/retries/breakers/bulkheads on all I/O"; tag ckpt/7.1-resilience-io-stable
```

#### Chunk 7.2 — Idempotency keys on mutating endpoints  **[Opus]**

```
Read CLAUDE.md.
OBJECTIVE: Safe client retries.
BUILD:
- Idempotency-Key header support on all unsafe public POSTs (invoices, transactions, etc.):
  store key+response, replay the stored response on duplicate, scoped per tenant.
GATE: same request with same key twice -> one effect, identical response both times.
CHECKPOINT: "feat: idempotency keys on mutating endpoints"; tag ckpt/7.2-idempotency-stable
```

#### Chunk 7.3 — Sagas / compensating transactions  **[Opus, plan mode]**

```
Read CLAUDE.md, ADR-004.
OBJECTIVE: Multi-step, multi-module workflows that recover from partial failure.
BUILD:
- Implement one real saga, e.g. order-to-cash: reserve stock -> create invoice ->
  on payment, commit; on any step failure, run compensations (release reservation, void invoice).
- Orchestrate via events + a saga state table; each step idempotent.
GATE: inject a failure at each step -> compensations restore a consistent state (no orphaned reservation/invoice).
CHECKPOINT: "feat: order-to-cash saga with compensations"; tag ckpt/7.3-saga-stable
```

#### Chunk 7.4 — Graceful degradation, shutdown, backpressure, rate limiting  **[Opus]**

```
Read CLAUDE.md.
OBJECTIVE: Behave well under overload and during deploys.
BUILD:
- Graceful shutdown drains HTTP + queue consumers before exit.
- Readiness gating: unready instances are pulled from rotation.
- Backpressure on queue consumers (prefetch/concurrency caps).
- @nestjs/throttler: per-IP and per-tenant limits; 429 with Retry-After.
GATE: under synthetic overload, the system sheds load (429) instead of falling over;
  a rolling restart loses zero in-flight work.
CHECKPOINT: "feat: graceful degradation + backpressure + rate limiting"; tag ckpt/7.4-overload-stable
```

#### Chunk 7.5 — Failure/chaos test suite  **[Sonnet]**

```
Read CLAUDE.md.
OBJECTIVE: Lock in resilience with repeatable tests.
BUILD:
- A test suite that kills/slows each dependency (db, redis, broker, ml) and asserts bounded,
  documented behavior for each. Wire it into CI as a separate (allowed-to-be-slower) job.
GATE: full chaos suite green; behaviors documented in docs/resilience.md.
CHECKPOINT: "test: chaos/failure suite + resilience docs"; tag ckpt/7.5-chaos-stable
```

---

### PHASE 8 — Observability & Security Hardening

#### Chunk 8.1 — Distributed tracing + structured logs  **[Opus]**

```
Read CLAUDE.md, ADR-007.
OBJECTIVE: One trace from API through broker/worker to ML.
BUILD:
- OpenTelemetry SDK in api, worker, ml; propagate trace context across HTTP AND the broker
  (inject/extract on publish/consume). Logs carry traceId, tenantId, userId, requestId.
- Export to the otel-collector from infra.
GATE: a single user action produces one connected trace spanning api->broker->worker(->ml).
CHECKPOINT: "feat: otel tracing + structured logs end-to-end"; tag ckpt/8.1-tracing-stable
```

#### Chunk 8.2 — Metrics + dashboards + alerts  **[Sonnet]**

```
Read CLAUDE.md.
OBJECTIVE: RED + USE visibility.
BUILD:
- GET /metrics (Prometheus). Custom metrics: request_duration_ms, active_tenants,
  queue_depth, outbox_lag, dlq_depth, breaker_state.
- Grafana dashboards + alert rules (e.g. dlq_depth > 0, outbox_lag rising, breaker open).
GATE: metrics scraped; dashboards render; an alert fires in a forced failure scenario.
CHECKPOINT: "feat: prometheus metrics + grafana dashboards + alerts"; tag ckpt/8.2-metrics-stable
```

#### Chunk 8.3 — Security hardening  **[Opus, plan mode]**

```
Read CLAUDE.md, ADR-006.
OBJECTIVE: Production security posture.
BUILD:
- Helmet (CSP, HSTS, X-Frame-Options), CORS locked to prod origins.
- Input sanitization on all string fields; payload size limits.
- Secret management: no secrets in env files in prod; load from a secrets manager.
- Dependency + container scanning in CI; fail the build on criticals.
- Verify the public allowlist is still exactly /health* + /auth/* (no accidental open routes).
GATE: a route audit script confirms every non-allowlisted route is guarded; scanners pass.
CHECKPOINT: "feat: security hardening (helmet/cors/secrets/scanning)"; tag ckpt/8.3-security-stable
```

---

### PHASE 9 — Production & Delivery

#### Chunk 9.1 — Production Docker builds  **[Sonnet]**

```
Read CLAUDE.md.
BUILD: multi-stage Dockerfiles per app (builder -> slim/distroless runner), non-root user,
  HEALTHCHECK in each, .dockerignore per app. infra/docker-compose.prod.yml for the full stack.
GATE: docker compose -f infra/docker-compose.prod.yml up -> all healthy; images run as non-root.
CHECKPOINT: "build: production multi-stage images"; tag ckpt/9.1-images-stable
```

#### Chunk 9.2 — Migrations finalize + seed + backup  **[Opus]**

```
Read CLAUDE.md, ADR-003.
BUILD:
- Confirm ZERO reliance on synchronize; full migration set runs clean from an empty DB and is idempotent.
- Seed script: demo tenant + TENANT_ADMIN + sample data across all modules.
- pg_dump backup script with optional S3/MinIO upload + a tested restore script.
- PgBouncer prod config: pool_mode=transaction, max_client_conn=200.
GATE: empty DB -> migrate -> seed -> app boots; backup then restore reproduces the data.
CHECKPOINT: "chore: migrations finalize + seed + backup/restore"; tag ckpt/9.2-data-stable
```

#### Chunk 9.3 — CI (with Claude Code headless review)  **[Sonnet]**

```
Read CLAUDE.md.
BUILD: .github/workflows/ci.yml on PR -> lint, typecheck, unit, e2e, dependency+container scan,
  with caching (pnpm store, pip, docker layers). Add a `claude -p` headless step that reviews the
  diff against CLAUDE.md conventions and posts findings (non-blocking advisory at first).
GATE: CI green on a clean PR; headless review step runs and comments.
CHECKPOINT: "ci: full pipeline + headless claude review"; tag ckpt/9.3-ci-stable
```

#### Chunk 9.4 — CD + runbook + final acceptance  **[Opus]**

```
Read CLAUDE.md.
BUILD:
- deploy-staging.yml on merge to main -> build images -> push to registry -> deploy staging.
- Canary/blue-green step with automatic rollback on failed health/readiness.
- docs/runbook.md: deploy, rollback, on-call alerts, DLQ drain, backup restore.
- Update CLAUDE.md with final architecture + deployment notes.
FINAL ACCEPTANCE:
  - create tenant -> create user -> login -> exercise all modules
  - fire each domain event end-to-end; confirm worker + notifications + realtime + traces
  - kill ML; confirm graceful degradation
  - rolling restart; confirm zero lost in-flight work
GATE: the full acceptance script passes; pnpm -w test and pnpm -w build clean.
CHECKPOINT: "release: CD + runbook + green acceptance"; tag ckpt/9.4-release-stable
```

---

## 3. Reusable Patterns Appendix

### Appendix A — Specs the chunks reference

**A1. BaseEntity** — abstract: `id uuid pk`, `tenantId uuid not null`, `createdAt`, `updatedAt`, `deletedAt` (`@DeleteDateColumn`), `createdBy`, `updatedBy`. Every business entity extends it.

**A2. Transactional outbox** — In the same DB transaction as the business write, insert an `outbox_event` row. A separate relay (poll + `FOR UPDATE SKIP LOCKED`) publishes and stamps `publishedAt`. Never `publish()` inside request handling.

**A3. Idempotent consumer** — On receive: begin tx → check `processed_event(eventId)` → if seen, ack & return → else apply effect + insert `processed_event` → commit → ack. Redelivery is therefore safe.

**A4. Money** — `{ amountMinor: integer, currency: ISO-4217 }`. All arithmetic on integers. Format at the edge only. PKR default.

**A5. Event contract versioning** — `domain.event.vN`. Additive changes bump nothing; breaking changes add `.v(N+1)` and run both until consumers migrate.

**A6. Result envelope** — success `{ data, meta }`; errors RFC 7807 `application/problem+json`.

### Appendix B — `.claude/settings.json` hooks (always-run gates)

```jsonc
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Write|Edit",
        "command": "scripts/secret-scan.sh \"$CLAUDE_TOOL_FILE\"" }   // block writes containing secrets
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit",
        "command": "pnpm -w exec tsc --noEmit || echo 'TYPECHECK FAILED — fix before continuing'" }
    ]
  }
}
```
Hooks (not prompt text) are how you guarantee something runs every time, even if the model forgets.

### Appendix C — Custom subagents (`.claude/agents/`)

- **explorer** — read-only; maps the repo and returns a file/pattern digest for the chunk. Run it in PRE-FLIGHT so the main session starts oriented without burning context.
- **reviewer** — audits the working diff against `CLAUDE.md` (tenant scope present? migration written? guard applied? event via outbox? timeout on new I/O?). Run before every CHECKPOINT.
- **test-writer** — generates `*.spec.ts` for new services from the DTO + service signatures.
- **module-scaffold** *(skill, `.claude/skills/module-scaffold/`)* — stamps the standard module folder so Phase 3 chunks stay short.

### Appendix D — Per-chunk gate checklist (paste into reviewer)

```
[ ] typecheck clean   [ ] lint clean   [ ] unit tests for touched code green
[ ] every new query tenant-scoped (RLS + repo)
[ ] every new entity has a migration; migration:run idempotent
[ ] every new route guarded (or on the documented public allowlist)
[ ] every domain side-effect emitted via the OUTBOX, not inline publish
[ ] every new outbound call has timeout + retry/backoff + failure path
[ ] CLAUDE.md + CHANGELOG-BUILD.md updated
[ ] committed + tagged ckpt/<phase>.<chunk>-stable
```

---

## 4. Claude Code Command & Model Reference (current — verified June 2026)

### 4.1 Models

| Use | Model | String / alias |
|---|---|---|
| Architecture, security, reliability, sagas | **Opus 4.8** | `claude-opus-4-8` (alias `opus`) |
| Implementation, modules, CRUD | **Sonnet 4.6** | `claude-sonnet-4-6` (alias `sonnet`) |
| Scaffolding, subagents, exploration | **Haiku 4.5** | `claude-haiku-4-5` (alias `haiku`) |

> On the Anthropic API, `opus` → Opus 4.8 and `sonnet` → Sonnet 4.6. Opus 4.8 needs Claude Code **v2.1.154+** (`claude update`). On Bedrock/Vertex/Foundry the `opus`/`sonnet` aliases lag — pin full names (`ANTHROPIC_DEFAULT_OPUS_MODEL`) before rolling out.

### 4.2 Commands

| Command | Use |
|---|---|
| `claude` | Start a session in the repo root |
| `claude --model opus` / `/model opus` | Launch on / switch to a model (`/status` shows the active one) |
| `claude --model opusplan` | Plan with Opus, execute with Sonnet — ideal for Phases 2, 4, 7 |
| plan mode (`shift+tab`, or `--permission-mode plan`) | Force a written plan + repo exploration before edits |
| `/agents` | Create/run subagents (Explore, Plan, custom reviewer/test-writer) |
| `/mcp` | Manage MCP servers (e.g. GitHub, your DB) |
| `/compact` | Compress context — last resort; prefer ending the chunk |
| `/init` | Auto-generate a first-pass `CLAUDE.md` from the codebase |
| `claude -p "<prompt>"` | Headless one-shot (CI review, scripted checks) |
| `claude update` | Upgrade the CLI (needed for the newest models) |

### 4.3 Model-per-phase

| Phase | Model | Why |
|---|---|---|
| 0 Genesis | Opus (plan) | Decisions set the whole build |
| 1 Foundation | Opus for 1.3/1.4, Sonnet/Haiku for 1.1/1.2 | Tenancy kernel is the keystone |
| 2 Identity/Security | Opus (`opusplan`) | Security logic must be reasoned, not pattern-matched |
| 3 Core modules | Sonnet (Opus for Finance) | CRUD is fast on Sonnet; Finance has invariants |
| 4 Event backbone | Opus | Reliability + multi-service coordination |
| 5 Integrations | Sonnet | Mostly wiring |
| 6 AI/ML | Sonnet (Opus for the bridge) | FastAPI is boilerplate; the resilient bridge is not |
| 7 Resilience | Opus (plan) | This is architecture |
| 8 Observability/Security | Opus 8.1/8.3, Sonnet 8.2 | Tracing + security need care |
| 9 Production | Opus 9.2/9.4, Sonnet 9.1/9.3 | Data + release are high-stakes |

---

*MetaXperts ERP — NestJS + Next.js + FastAPI + (BullMQ worker, Go only on measured need) + PostgreSQL 16/RLS + RabbitMQ + Redis. Built in session-sized, checkpointed, gate-verified chunks for Claude Code v2.1.154+.*
