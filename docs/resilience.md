# Resilience & Fault Tolerance

How MetaXperts ERP behaves when each dependency is slow or down. Every outbound call is bounded
(timeout), bounded-retried, circuit-broken where a remote is involved, and bulkheaded so one slow
dependency can't starve the rest. Nothing waits forever; nothing cascades into a process-wide outage.

Primitives live in `apps/api/src/common/resilience/` (`withTimeout`, `withRetry`, `Bulkhead`,
`CircuitBreaker`). The behaviours below are locked in by the **chaos suite**
(`apps/api/test/chaos-e2e.sh`, run via `pnpm --filter @app/api test:chaos`) and the per-area gates
(`resilience-e2e.sh`, `ml-bridge-e2e.sh`, `overload-e2e.sh`).

## Per-dependency behaviour

| Dependency | Bounding | On failure | Documented behaviour |
|---|---|---|---|
| **Postgres** (via PgBouncer) | `connectionTimeoutMillis` 5s; per-tenant-tx `SET LOCAL statement_timeout` (10s) / `lock_timeout` (5s) / `idle_in_transaction_session_timeout` (15s); pool max 20 | Slow query is **cancelled** at the statement timeout; the request errors fast instead of pinning a connection | Chaos 1: a 5s query is cancelled at ~0.5s; `/health` stays 200 |
| **Redis** | `maxRetriesPerRequest` 1, `connectTimeout` 3s, `enableOfflineQueue: false` (fail-fast, no infinite offline queue) | Commands fail fast; readiness reports unhealthy | Chaos 4: `/health` (liveness) 200, `/health/ready` **503** (bounded) → the LB pulls the instance |
| **RabbitMQ** (broker) | Relay publish wrapped in `withTimeout` (`BROKER_PUBLISH_TIMEOUT_MS`) + a `CircuitBreaker`; resilient auto-reconnect | Publish fails fast / breaker opens; the outbox row stays **pending** and is retried later (no event lost) | Chaos 3: closing a deal still returns 200, the event is safely pending in the outbox, `/health` 200 |
| **ML service** (`apps/ml`) | Service token + `withTimeout` (`ML_HTTP_TIMEOUT_MS`) + `withRetry` + `CircuitBreaker` + `Bulkhead` (`ML_MAX_CONCURRENCY`) + Redis forecast cache | Returns a typed **degraded** response (last-known forecast from cache, or empty-but-valid); never throws | Chaos 2 / ml-bridge-e2e: AI routes return **200 degraded**, the breaker opens, the API never 5xxs |
| **SMTP** | Nodemailer connection/socket timeouts (5s); delivery via a BullMQ queue with backoff retries | In-app notification is committed first; email retries async; a down SMTP never blocks the durable notification | notifications gate |

## Cross-cutting

- **Retries** are always capped (`withRetry`, exponential backoff + jitter) and skip non-retryable
  errors — a flapping dependency can't loop forever.
- **Circuit breakers** (CLOSED → OPEN after a failure threshold → HALF_OPEN after a cooldown → CLOSED
  on a successful trial) fail fast while a dependency is clearly down, instead of hammering it.
- **Bulkheads** cap concurrent in-flight calls per dependency (bounded queue, then `BulkheadFullError`)
  so one slow dependency can't exhaust threads / the DB pool.
- **Backpressure**: event consumers cap unacked messages via prefetch (`CONSUMER_PREFETCH`).
- **Idempotency**: unsafe POSTs accept an `Idempotency-Key`; a duplicate replays the stored response
  (one effect). Event consumers dedupe via `processed_event`. So client/broker retries are safe.
- **Sagas**: multi-step workflows (order-to-cash) compensate completed steps on a later failure — no
  orphaned state.

## Overload & deploys

- **Rate limiting** (`@nestjs/throttler`, per-tenant / per-IP): over the limit → **429 + Retry-After**.
  The system sheds load instead of falling over. Health probes are exempt.
- **Graceful shutdown**: on `SIGTERM` the instance flips to draining → `/health/ready` returns 503 for
  `SHUTDOWN_DRAIN_MS` so the LB pulls it from rotation, then `enableShutdownHooks` drains in-flight HTTP
  + queue consumers before exit. A rolling restart loses zero in-flight work.

## Running the chaos suite

```bash
pnpm --filter @app/api build
pnpm --filter @app/api test:chaos   # boots a misconfigured instance per scenario; ~slower
```

It is intentionally **not** part of the main e2e chain (it boots several deliberately-broken
instances). Wire it into CI as a separate, allowed-to-be-slower job.
