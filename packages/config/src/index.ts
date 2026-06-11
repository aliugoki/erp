/**
 * @metaxperts/config — environment schema + typed loader.
 *
 * Consumed by apps/api and apps/worker. Validates `process.env` once at boot and fails fast on a bad
 * or missing variable (ADR: fail fast on misconfiguration). Keep this in sync with `.env.example`.
 */
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

  // Money default (ADR-007).
  DEFAULT_CURRENCY: z.string().length(3).default('PKR'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

/** The validated, typed config object. */
export type AppConfig = z.infer<typeof envSchema>;

/**
 * Validate and return the typed config from a raw env source (defaults to `process.env`).
 * Throws a readable aggregated error and is intended to be called once at process startup.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
