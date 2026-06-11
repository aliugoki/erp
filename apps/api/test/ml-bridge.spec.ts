/**
 * API↔ML bridge test (Chunk 6.5 gate). Proves the resilience contract WITHOUT a live ML service:
 *  - the circuit breaker opens after a failure threshold, fails fast while open, half-opens after the
 *    cooldown, and closes on a successful trial (re-opens if the trial fails),
 *  - MlService NEVER throws when ML is down — it returns a typed `degraded` response, serving the
 *    last-known forecast from cache when available (no 5xx cascade).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../src/modules/ai/circuit-breaker';
import { MlService } from '../src/modules/ai/ml.service';

const fail = () => Promise.reject(new Error('boom'));
const ok = () => Promise.resolve('ok');

describe('CircuitBreaker', () => {
  it('opens after the threshold, fails fast, half-opens after cooldown, then closes on success', async () => {
    let t = 0;
    const cb = new CircuitBreaker({ name: 'ml', threshold: 2, cooldownMs: 1000, now: () => t });

    await expect(cb.exec(fail)).rejects.toThrow('boom');
    await expect(cb.exec(fail)).rejects.toThrow('boom');
    expect(cb.currentState).toBe('OPEN');

    // While open (within cooldown) the call short-circuits — it never invokes fn.
    const spy = vi.fn(ok);
    await expect(cb.exec(spy)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(spy).not.toHaveBeenCalled();

    // After the cooldown → half-open trial allowed; success closes the breaker.
    t += 1001;
    expect(cb.currentState).toBe('HALF_OPEN');
    await expect(cb.exec(ok)).resolves.toBe('ok');
    expect(cb.currentState).toBe('CLOSED');
  });

  it('re-opens if the half-open trial fails', async () => {
    let t = 0;
    const cb = new CircuitBreaker({ name: 'ml', threshold: 1, cooldownMs: 500, now: () => t });
    await expect(cb.exec(fail)).rejects.toThrow();
    expect(cb.currentState).toBe('OPEN');
    t += 501;
    await expect(cb.exec(fail)).rejects.toThrow('boom'); // half-open trial fails
    expect(cb.currentState).toBe('OPEN');
  });
});

function makeService(overrides: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  const cfg: Record<string, unknown> = {
    ML_BASE_URL: 'http://ml.test',
    ML_HTTP_TIMEOUT_MS: 1000,
    ML_RETRY_ATTEMPTS: 0,
    ML_FORECAST_CACHE_TTL_S: 3600,
    ML_BREAKER_THRESHOLD: 2,
    ML_BREAKER_COOLDOWN_MS: 10000,
    ...overrides,
  };
  const config = { get: (k: string) => cfg[k] } as never;
  const serviceToken = { issue: () => 'svc-token' } as never;
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); return 'OK'; },
  } as never;
  return { ml: new MlService(serviceToken, redis, config), store };
}

describe('MlService degraded behaviour (ML down)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('forecast returns a typed degraded response instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const { ml } = makeService();
    const res = await ml.forecastDemand('t1', '11111111-1111-1111-1111-111111111111', { horizon: 7 });
    expect(res.degraded).toBe(true);
    expect(res.source).toBe('degraded');
    expect(res.predicted).toEqual([]);
    expect(res.model).toBe('unavailable');
  });

  it('serves the last-known forecast from cache when ML is down', async () => {
    const { ml } = makeService();
    const payload = { productId: 'p', warehouseId: null, horizon: 7, model: 'arima', source: 'cache', historyPoints: 30, dates: ['2026-03-16'], predicted: [5], lower: [3], upper: [7] };

    // 1) A live success populates the cache.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
    const live = await ml.forecastDemand('t1', 'p', { horizon: 7 });
    expect(live.degraded).toBe(false);
    expect(live.source).toBe('live');

    // 2) ML goes down → the bridge serves the cached forecast (degraded), not an error.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const cached = await ml.forecastDemand('t1', 'p', { horizon: 7 });
    expect(cached.degraded).toBe(true);
    expect(cached.source).toBe('cache');
    expect(cached.predicted).toEqual([5]);
  });

  it('anomaly scan degrades to an empty result set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const { ml } = makeService();
    const res = await ml.scanAnomalies('t1', {});
    expect(res.degraded).toBe(true);
    expect(res.count).toBe(0);
    expect(res.items).toEqual([]);
  });

  it('opens the breaker after repeated failures (subsequent calls short-circuit, still degraded)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    const { ml } = makeService({ ML_BREAKER_THRESHOLD: 2 });
    await ml.scanAnomalies('t1', {}); // failure 1
    await ml.scanAnomalies('t1', {}); // failure 2 → breaker opens
    expect(ml.breakerState).toBe('OPEN');
    const callsBefore = fetchMock.mock.calls.length;
    const res = await ml.scanAnomalies('t1', {}); // short-circuits, no new fetch
    expect(res.degraded).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(callsBefore); // breaker prevented the HTTP call
  });
});
