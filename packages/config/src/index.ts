/**
 * @metaxperts/config — environment schema + typed loader.
 *
 * Consumed by apps/api and apps/worker. Validates `process.env` once at boot and fails fast on a bad
 * or missing variable (ADR: fail fast on misconfiguration). Keep this in sync with `.env.example`.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const portFromString = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().positive());

/** The full environment schema. Add variables here as the stack grows. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_PORT: portFromString(3000),
  WORKER_PORT: portFromString(3002),

  // Database — apps connect THROUGH PgBouncer (transaction pool mode), not directly to Postgres.
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgresql://')),
  // Migrations connect DIRECTLY to Postgres (DDL + a stable session; bypass the pooler).
  // Falls back to DATABASE_URL if unset.
  MIGRATION_DATABASE_URL: z.string().startsWith('postgresql://').optional(),

  // Redis — cache, BullMQ queues, refresh-token store.
  REDIS_URL: z.string().startsWith('redis://').default('redis://localhost:6379'),

  // RabbitMQ — event broker.
  RABBITMQ_URL: z.string().startsWith('amqp://').default('amqp://localhost:5672'),

  // Auth (Phase 2). Access tokens are short-lived JWTs; refresh tokens are opaque + rotated.
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_SECONDS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 60 * 60 * 24 * 7 : Number(v)))
    .pipe(z.number().int().positive()),

  // Service-to-service auth (API ↔ ML / worker): short-lived signed token on internal endpoints.
  SERVICE_AUTH_SECRET: z.string().min(16),
  SERVICE_AUTH_TTL: z.string().default('5m'),

  // Outbox relay (Phase 4): poll the outbox and publish pending events. Disabled in tests.
  OUTBOX_RELAY_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean()),
  OUTBOX_POLL_INTERVAL_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 2000 : Number(v)))
    .pipe(z.number().int().positive()),
  OUTBOX_BATCH_SIZE: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 100 : Number(v)))
    .pipe(z.number().int().positive()),

  // Event reaction handlers (Phase 4.4): register the worker consumers. Disabled in tests.
  WORKER_REACTIONS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean()),

  // Notifications (Phase 5.1). The consumer that turns domain events into in-app notifications.
  // Disabled in tests (the unit spec drives the service directly).
  NOTIFICATIONS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean()),
  // Email side-channel: best-effort, retried via a BullMQ queue. Off by default → in-app only,
  // so a missing/down SMTP server never blocks the durable in-app notification.
  NOTIFICATIONS_EMAIL_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean()),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: portFromString(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('MetaXperts ERP <no-reply@metaxperts.local>'),

  // Reporting (Phase 5.2): periodically recompute the read-model tables. Disabled in tests, which
  // refresh on demand via POST /reports/refresh for determinism.
  REPORTING_REFRESH_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean()),
  REPORTING_REFRESH_INTERVAL_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 60_000 : Number(v)))
    .pipe(z.number().int().positive()),

  // Scheduled report emails: a tick finds due report_schedule rows, renders the report and emails it
  // (via the email queue). Off by default; needs NOTIFICATIONS_EMAIL_ENABLED + SMTP to actually send.
  REPORT_SCHEDULES_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean()),
  REPORT_SCHEDULES_INTERVAL_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 60_000 : Number(v)))
    .pipe(z.number().int().positive()),

  // Public base URL of the storefront (apps/web), used to build absolute links in customer emails
  // (e.g. password-reset). Optional — when unset, emails include the bare token instead of a link.
  STOREFRONT_BASE_URL: z.string().url().optional(),

  // API → ML bridge (Phase 6.5). Resilient HTTP client to apps/ml: timeout + retry + circuit breaker
  // + Redis forecast cache, so ML being down degrades gracefully instead of cascading 500s.
  ML_BASE_URL: z.string().url().default('http://localhost:8000'),
  ML_HTTP_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 4000 : Number(v)))
    .pipe(z.number().int().positive()),
  ML_RETRY_ATTEMPTS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 2 : Number(v)))
    .pipe(z.number().int().nonnegative()),
  ML_BREAKER_THRESHOLD: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 5 : Number(v)))
    .pipe(z.number().int().positive()),
  ML_BREAKER_COOLDOWN_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 10000 : Number(v)))
    .pipe(z.number().int().positive()),
  ML_FORECAST_CACHE_TTL_S: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 3600 : Number(v)))
    .pipe(z.number().int().positive()),
  // Bulkhead: max concurrent in-flight ML calls (Phase 7.1) so a slow ML can't starve the API.
  ML_MAX_CONCURRENCY: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 10 : Number(v)))
    .pipe(z.number().int().positive()),

  // Broker publish resilience (Phase 7.1): bound the relay's publish + a breaker on the broker.
  BROKER_PUBLISH_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 3000 : Number(v)))
    .pipe(z.number().int().positive()),
  BROKER_BREAKER_THRESHOLD: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 5 : Number(v)))
    .pipe(z.number().int().positive()),
  BROKER_BREAKER_COOLDOWN_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 10000 : Number(v)))
    .pipe(z.number().int().positive()),

  // Postgres per-connection safety limits (Phase 7.1): no query/lock/idle-txn waits unbounded.
  DB_STATEMENT_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 10000 : Number(v)))
    .pipe(z.number().int().positive()),
  DB_LOCK_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 5000 : Number(v)))
    .pipe(z.number().int().positive()),
  DB_IDLE_TX_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 15000 : Number(v)))
    .pipe(z.number().int().positive()),

  // Rate limiting (Phase 7.4): per-tenant (authenticated) / per-IP (anonymous) request limits.
  THROTTLE_TTL_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 60_000 : Number(v)))
    .pipe(z.number().int().positive()),
  THROTTLE_LIMIT: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 300 : Number(v)))
    .pipe(z.number().int().positive()),
  // Graceful shutdown (Phase 7.4): how long /health/ready reports draining (503) before the server
  // stops accepting, so a load balancer can pull the instance with zero in-flight loss.
  SHUTDOWN_DRAIN_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 0 : Number(v)))
    .pipe(z.number().int().nonnegative()),
  // Backpressure (Phase 7.4): per-consumer prefetch / concurrency cap.
  CONSUMER_PREFETCH: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 10 : Number(v)))
    .pipe(z.number().int().positive()),

  // Distributed tracing (Phase 8.1): start the OpenTelemetry SDK + export to the otel-collector.
  // Off by default (tests/local without a collector); enable in deployed envs.
  OTEL_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean()),

  // Metrics (Phase 8.2): how often the operational gauges (outbox lag, DLQ depth, …) are refreshed,
  // and the RabbitMQ management API for queue depth.
  METRICS_COLLECT_INTERVAL_MS: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 10_000 : Number(v)))
    .pipe(z.number().int().positive()),
  RABBITMQ_MGMT_URL: z.string().url().default('http://localhost:15672'),

  // Security hardening (Phase 8.3). CORS_ORIGINS: comma-separated allowlist of web origins; empty
  // reflects the request origin (dev only). MAX_BODY_SIZE caps request payloads (→ 413).
  CORS_ORIGINS: z.string().optional().default(''),
  MAX_BODY_SIZE: z.string().default('1mb'),

  // Money default (ADR-007).
  DEFAULT_CURRENCY: z.string().length(3).default('PKR'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

/** The validated, typed config object. */
export type AppConfig = z.infer<typeof envSchema>;

/**
 * Resolve `*_FILE` secret references (Phase 8.3 — Docker/Kubernetes secrets convention). For any
 * `FOO_FILE=/run/secrets/foo`, read the file and use its trimmed contents as `FOO`. Lets production
 * load secrets from a mounted secrets store instead of plaintext env vars. The explicit env var wins
 * if both are set.
 */
function resolveFileSecrets(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...source };
  for (const [key, value] of Object.entries(source)) {
    if (!key.endsWith('_FILE') || !value) continue;
    const target = key.slice(0, -'_FILE'.length);
    if (out[target]) continue; // explicit env var takes precedence
    try {
      out[target] = readFileSync(value, 'utf8').trim();
    } catch (err) {
      throw new Error(`Could not read secret file for ${target} (${key}=${value}): ${(err as Error).message}`);
    }
  }
  return out;
}

/**
 * Validate and return the typed config from a raw env source (defaults to `process.env`).
 * Throws a readable aggregated error and is intended to be called once at process startup.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(resolveFileSecrets(source));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
