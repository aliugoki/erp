# MetaXperts ERP — Operations Runbook

Operational guide for deploying, recovering, and running MetaXperts ERP in production. Pairs with
the production stack in `infra/docker-compose.prod.yml` and the scripts in `infra/scripts/`.

---

## 1. Topology

The full system runs in containers (Chunk 9.1): **api** (NestJS), **worker** (NestJS/BullMQ),
**web** (Next.js standalone), **ml** (FastAPI) + Postgres 16 (pgvector), PgBouncer, Redis, RabbitMQ,
MinIO, OTel Collector, Prometheus, Grafana. Apps reach Postgres **through PgBouncer as `app_user`**
(non-superuser → Row-Level Security enforced); migrations/relay use the owner connection directly.

Health surfaces:
- `GET /health` — liveness (process up).
- `GET /health/ready` — readiness (Postgres + Redis reachable; reports 503 while draining for
  shutdown so a load balancer pulls the instance before it stops accepting).
- `GET /metrics` — Prometheus exposition (RED + USE: request duration, active tenants, outbox lag,
  DLQ depth, breaker state, queue depth).

---

## 2. Deploy

```bash
# 1. Build + start the full stack
docker compose -f infra/docker-compose.prod.yml up -d --build

# 2. Run migrations (idempotent; safe to re-run). Point MIGRATION_DATABASE_URL at the DB.
MIGRATION_DATABASE_URL=postgresql://metaxperts:<pw>@<db-host>:5432/metaxperts \
  pnpm --filter @app/api migration:run

# 3. (First deploy / demo) seed a tenant + sample data
API_URL=http://<api-host>:3300 OWNER_URL=postgresql://metaxperts:<pw>@<db-host>:5432/metaxperts \
  bash infra/scripts/seed-demo.sh
```

Wait until every service is healthy: `docker compose -f infra/docker-compose.prod.yml ps`
(minio/otel are distroless without an in-container healthcheck — verify by probe). Apps run as
**non-root** (api/worker/web uid 65532, ml uid 10001).

**Secrets.** Supply `JWT_ACCESS_SECRET` / `SERVICE_AUTH_SECRET` via your secret store, or mount files
and use the `*_FILE` convention the config loader supports (`JWT_ACCESS_SECRET_FILE=/run/secrets/…`).
Never ship real secrets in env literals.

**Background workers.** The outbox relay, event reactions, notifications, and reporting refresh are
flag-gated (`OUTBOX_RELAY_ENABLED`, `WORKER_REACTIONS_ENABLED`, `NOTIFICATIONS_ENABLED`,
`REPORTING_REFRESH_ENABLED`). Enable them **after** the schema is migrated.

---

## 3. Rolling restart (zero in-flight loss)

`SHUTDOWN_DRAIN_MS` makes `/health/ready` report 503 for that window before the server stops
accepting, so the LB drains the instance first. Restart one app instance at a time:

```bash
docker compose -f infra/docker-compose.prod.yml up -d --no-deps --force-recreate api
```

In-flight domain side-effects are safe regardless: they're written to the **transactional outbox** in
the same DB transaction as the business change, so a crash mid-publish never loses an event — the
relay re-publishes from the outbox on restart (exactly-once via `FOR UPDATE SKIP LOCKED`).

---

## 4. Rollback

```bash
# App rollback: redeploy the previous image tag
docker compose -f infra/docker-compose.prod.yml up -d api web worker   # with prior image tags

# Data rollback (DESTRUCTIVE): restore the last good backup
bash infra/scripts/restore.sh backups/metaxperts-<stamp>.dump
```

Migrations are reversible (`migration:revert`) but prefer roll-forward; only revert a migration you
just shipped and know is isolated.

---

## 5. Backups

```bash
bash infra/scripts/backup.sh                 # -> backups/metaxperts-<UTC>.dump (custom format)
S3_BUCKET=my-bucket bash infra/scripts/backup.sh   # + offsite copy (needs aws CLI)
```

Schedule daily (cron / scheduled job). **Test restores regularly** into a scratch DB:

```bash
createdb scratch && DB_NAME=scratch FORCE=1 bash infra/scripts/restore.sh backups/<latest>.dump
```

---

## 6. On-call: alerts → actions

Prometheus alert rules live in `infra/prometheus-alerts.yml`; Grafana dashboards are provisioned.

| Alert | Meaning | Action |
|---|---|---|
| **ApiDown** | `/metrics` scrape failing | Check `docker compose ps`, api logs; restart api. |
| **CircuitBreakerOpen** | `metaxperts_breaker_state{breaker}` open | A remote (ML/broker) is failing; the app is degrading gracefully. Check that dependency. |
| **OutboxLagHigh** | `metaxperts_outbox_lag` rising | Relay not draining — is `OUTBOX_RELAY_ENABLED` on and RabbitMQ healthy? Check relay logs. |
| **DLQNotEmpty** | `metaxperts_dlq_depth > 0` | Poison/failed events parked. See §7. |

### Graceful degradation (expected, not an outage)
- **ML down** → AI endpoints return `200` with `degraded: true` (last-known forecast from Redis); the
  breaker opens. No action beyond restoring ML.
- **Broker down** → writes still commit; events sit `published_at IS NULL` in the outbox and flush
  when the broker returns.
- **Redis down** → liveness stays `200`; readiness `503` (LB pulls the instance).

---

## 7. DLQ drain

Dead-lettered domain events are inspected and requeued via the admin API (RBAC: admin):

```bash
# List parked events
curl -H "authorization: Bearer <admin-jwt>" http://<api>:3300/admin/dlq

# Requeue one back to its consumer after fixing the cause
curl -X POST -H "authorization: Bearer <admin-jwt>" http://<api>:3300/admin/dlq/<id>/requeue
```

Investigate the root cause (bad payload, downstream bug) before requeuing. Consumers are idempotent
(`processed_event` dedupe), so a re-delivery is safe.

---

## 8. Observability

- **Traces:** one user action is one connected trace across api → broker → worker → ml (OTel; trace
  context propagated over HTTP, the broker, and the outbox). View in the collector / your tracing
  backend. Toggle with `OTEL_ENABLED`.
- **Logs:** structured JSON carrying `traceId`, `tenantId`, `userId`, `requestId`.
- **Metrics/dashboards:** Prometheus + Grafana (provisioned datasource + dashboard).

---

## 9. Scaling notes

- **Connections:** PgBouncer `pool_mode=transaction`, `max_client_conn=200`. RLS relies on
  transaction-local `set_config('app.tenant_id', …, true)` — keep transaction pooling.
- **Consumers:** `CONSUMER_PREFETCH` bounds unacked messages per consumer (backpressure).
- **Rate limit:** `THROTTLE_LIMIT` / `THROTTLE_TTL_MS` per tenant/IP → 429 + Retry-After.
- **Reactions throughput:** measured ~1,130 events/sec in-process (ADR-001) — scale the worker out
  before reaching for Go.
