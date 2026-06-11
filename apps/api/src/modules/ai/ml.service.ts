import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { AppConfig } from '@metaxperts/config';
import type {
  MlAnomalyResponse,
  MlForecastResponse,
  MlInvoiceExtractResponse,
} from '@metaxperts/shared';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { Bulkhead, CircuitBreaker } from '../../common/resilience';
import { ServiceTokenService } from '../service-auth/service-token.service';

/** Every bridge response carries whether it came live, from cache, or as a typed degraded fallback. */
export type Source = 'live' | 'cache' | 'degraded';
export type Degradable<T> = T & { degraded: boolean; source: Source };

/**
 * The resilient bridge from the NestJS API to the Python ML service (Chunk 6.5, ADR-006). Every call
 * carries the signed service token and is wrapped in: a per-request TIMEOUT, RETRY with backoff, and a
 * shared CIRCUIT BREAKER. The public methods NEVER throw on an ML failure — they return a typed
 * degraded response (last-known forecast from Redis, or an empty-but-valid shape), so the ML service
 * being slow or down can never cascade into API 5xxs.
 */
@Injectable()
export class MlService {
  private readonly logger = new Logger(MlService.name);
  private readonly breaker: CircuitBreaker;
  private readonly bulkhead: Bulkhead;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly cacheTtl: number;

  constructor(
    private readonly serviceToken: ServiceTokenService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<AppConfig, true>,
  ) {
    this.baseUrl = config.get('ML_BASE_URL', { infer: true });
    this.timeoutMs = config.get('ML_HTTP_TIMEOUT_MS', { infer: true });
    this.retryAttempts = config.get('ML_RETRY_ATTEMPTS', { infer: true });
    this.cacheTtl = config.get('ML_FORECAST_CACHE_TTL_S', { infer: true });
    this.breaker = new CircuitBreaker({
      name: 'ml',
      threshold: config.get('ML_BREAKER_THRESHOLD', { infer: true }),
      cooldownMs: config.get('ML_BREAKER_COOLDOWN_MS', { infer: true }),
    });
    // Bulkhead OUTSIDE the breaker: an overload rejection (BulkheadFull) must not count as a
    // dependency failure that trips the breaker.
    this.bulkhead = new Bulkhead({
      name: 'ml',
      maxConcurrent: config.get('ML_MAX_CONCURRENCY', { infer: true }),
      maxQueue: config.get('ML_MAX_CONCURRENCY', { infer: true }),
    });
  }

  /** Current breaker state — surfaced on the health/status endpoint. */
  get breakerState(): string {
    return this.breaker.currentState;
  }

  // ── Public bridge methods (degraded-safe) ─────────────────────────────────

  async forecastDemand(
    tenantId: string,
    productId: string,
    opts: { warehouseId?: string; horizon?: number },
  ): Promise<Degradable<MlForecastResponse>> {
    const key = `ai:forecast:${tenantId}:${productId}`;
    try {
      const live = await this.postJson<MlForecastResponse>('/ml/forecast/demand', { tenantId, productId, ...opts });
      await this.redis.set(key, JSON.stringify(live), 'EX', this.cacheTtl).catch(() => undefined);
      return { ...live, degraded: false, source: 'live' };
    } catch (err) {
      this.logger.warn(`forecast degraded for ${productId}: ${(err as Error).message}`);
      const cached = await this.redis.get(key).catch(() => null);
      if (cached) return { ...(JSON.parse(cached) as MlForecastResponse), degraded: true, source: 'cache' };
      return {
        productId,
        warehouseId: opts.warehouseId ?? null,
        horizon: opts.horizon ?? 0,
        model: 'unavailable',
        source: 'degraded',
        historyPoints: 0,
        dates: [],
        predicted: [],
        lower: [],
        upper: [],
        degraded: true,
      };
    }
  }

  async scanAnomalies(
    tenantId: string,
    range: { dateFrom?: string; dateTo?: string },
  ): Promise<Degradable<MlAnomalyResponse>> {
    try {
      const live = await this.postJson<MlAnomalyResponse>('/ml/anomaly/transactions', { tenantId, ...range });
      return { ...live, degraded: false, source: 'live' };
    } catch (err) {
      this.logger.warn(`anomaly scan degraded: ${(err as Error).message}`);
      return { count: 0, anomalies: 0, items: [], degraded: true, source: 'degraded' };
    }
  }

  async extractInvoice(
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ): Promise<Degradable<MlInvoiceExtractResponse>> {
    try {
      const live = await this.postMultipart<MlInvoiceExtractResponse>('/ml/extract/invoice', file);
      return { ...live, degraded: false, source: 'live' };
    } catch (err) {
      this.logger.warn(`invoice extract degraded: ${(err as Error).message}`);
      return { vendor: null, date: null, total: null, taxAmount: null, lineItems: [], degraded: true, source: 'degraded' };
    }
  }

  // ── Transport: breaker → retry → timed fetch ──────────────────────────────

  private postJson<T>(path: string, body: unknown): Promise<T> {
    return this.bulkhead.run(() =>
      this.breaker.exec(() =>
        this.withRetry(() =>
          this.fetchJson<T>(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-service-token': this.serviceToken.issue() },
            body: JSON.stringify(body),
          }),
        ),
      ),
    );
  }

  private postMultipart<T>(path: string, file: { buffer: Buffer; originalname: string; mimetype: string }): Promise<T> {
    return this.bulkhead.run(() =>
      this.breaker.exec(() =>
        this.withRetry(() => {
          const form = new FormData();
          form.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
          return this.fetchJson<T>(path, {
            method: 'POST',
            headers: { 'x-service-token': this.serviceToken.issue() }, // fetch sets the multipart boundary
            body: form,
          });
        }),
      ),
    );
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt < this.retryAttempts) await this.sleep(100 * 2 ** attempt + Math.floor(50 * attempt));
      }
    }
    throw lastErr;
  }

  private async fetchJson<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
      if (!res.ok) throw new Error(`ML responded ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
