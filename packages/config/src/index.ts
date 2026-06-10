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

  // Redis — cache, BullMQ queues, refresh-token store.
  REDIS_URL: z.string().startsWith('redis://').default('redis://localhost:6379'),

  // RabbitMQ — event broker.
  RABBITMQ_URL: z.string().startsWith('amqp://').default('amqp://localhost:5672'),

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
