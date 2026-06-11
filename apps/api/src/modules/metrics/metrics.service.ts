import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { AppConfig } from '@metaxperts/config';
import { breakerRegistry } from '../../common/resilience/circuit-breaker';

const BREAKER_STATE_VALUE: Record<string, number> = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 };

/**
 * Prometheus metrics (Chunk 8.2) — RED (request rate/errors/duration) + USE-style gauges for the
 * event backbone. The registry is exposed at `GET /metrics`. Operational gauges (outbox lag, DLQ
 * depth, active tenants, breaker state, queue depth) are refreshed by a periodic collector; those that
 * span all tenants use a privileged (owner) connection so RLS doesn't zero them out.
 */
@Injectable()
export class MetricsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_ms',
    help: 'HTTP request duration in milliseconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [this.registry],
  });
  readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });
  private readonly activeTenants = new Gauge({ name: 'metaxperts_active_tenants', help: 'Provisioned tenants', registers: [this.registry] });
  private readonly outboxLag = new Gauge({ name: 'metaxperts_outbox_lag', help: 'Unpublished outbox events', registers: [this.registry] });
  private readonly outboxOldestAge = new Gauge({ name: 'metaxperts_outbox_oldest_age_seconds', help: 'Age of the oldest unpublished outbox event (s)', registers: [this.registry] });
  private readonly dlqDepth = new Gauge({ name: 'metaxperts_dlq_depth', help: 'Dead-letter parked events', registers: [this.registry] });
  private readonly breakerState = new Gauge({ name: 'metaxperts_breaker_state', help: 'Circuit breaker state (0 closed,1 half,2 open)', labelNames: ['breaker'], registers: [this.registry] });
  private readonly queueDepth = new Gauge({ name: 'metaxperts_queue_depth', help: 'Broker messages ready across queues', registers: [this.registry] });

  private pool?: Pool;
  private timer?: NodeJS.Timeout;
  private readonly intervalMs: number;
  private readonly ownerUrl: string;
  private readonly rabbitMgmt: string;

  constructor(config: ConfigService<AppConfig, true>) {
    collectDefaultMetrics({ register: this.registry });
    this.intervalMs = config.get('METRICS_COLLECT_INTERVAL_MS', { infer: true });
    this.ownerUrl = config.get('MIGRATION_DATABASE_URL', { infer: true }) ?? config.get('DATABASE_URL', { infer: true });
    // RabbitMQ management API for queue depth (best-effort; default guest creds in dev).
    this.rabbitMgmt = config.get('RABBITMQ_MGMT_URL', { infer: true });
  }

  observeHttp(method: string, route: string, status: number, durationMs: number): void {
    const labels = { method, route, status: String(status) };
    this.httpDuration.observe(labels, durationMs);
    this.httpRequests.inc(labels);
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  onApplicationBootstrap(): void {
    this.pool = new Pool({ connectionString: this.ownerUrl, max: 2, connectionTimeoutMillis: 3000 });
    this.pool.on('error', (e) => this.logger.warn(`metrics pool error: ${e.message}`));
    void this.collect();
    this.timer = setInterval(() => void this.collect(), this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  /** Refresh the operational gauges. Best-effort: a failing source doesn't break /metrics. */
  private async collect(): Promise<void> {
    for (const [name, get] of breakerRegistry) this.breakerState.set({ breaker: name }, BREAKER_STATE_VALUE[get()] ?? 0);
    try {
      const r = await this.pool!.query(
        `SELECT (SELECT count(*) FROM tenants) AS tenants,
                (SELECT count(*) FROM outbox_event WHERE published_at IS NULL) AS outbox_lag,
                (SELECT COALESCE(EXTRACT(EPOCH FROM now() - min(occurred_at)), 0) FROM outbox_event WHERE published_at IS NULL) AS oldest_age,
                (SELECT count(*) FROM dlq_event) AS dlq`,
      );
      const row = r.rows[0];
      this.activeTenants.set(Number(row.tenants));
      this.outboxLag.set(Number(row.outbox_lag));
      this.outboxOldestAge.set(Number(row.oldest_age));
      this.dlqDepth.set(Number(row.dlq));
    } catch (err) {
      this.logger.warn(`metrics db collect failed: ${(err as Error).message}`);
    }
    try {
      const res = await fetch(`${this.rabbitMgmt}/api/queues`, {
        headers: { authorization: `Basic ${Buffer.from('guest:guest').toString('base64')}` },
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const queues = (await res.json()) as Array<{ messages_ready?: number }>;
        this.queueDepth.set(queues.reduce((sum, q) => sum + (q.messages_ready ?? 0), 0));
      }
    } catch {
      // broker mgmt unavailable → leave queue_depth as-is (best-effort)
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    void this.pool?.end().catch(() => undefined);
  }
}
