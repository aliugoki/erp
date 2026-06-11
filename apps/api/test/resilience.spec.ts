/**
 * Resilience primitives test (Chunk 7.1 gate). Fault-injects latency and errors into each primitive
 * and asserts BOUNDED failure — a slow/erroring dependency is contained, never an unbounded hang or a
 * cascade. (The DB statement_timeout + the per-dependency breakers/bulkheads are exercised live by
 * resilience-e2e.sh.)
 */
import { describe, expect, it } from 'vitest';
import {
  Bulkhead,
  BulkheadFullError,
  CircuitBreaker,
  CircuitOpenError,
  TimeoutError,
  withRetry,
  withTimeout,
} from '../src/common/resilience';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('withTimeout', () => {
  it('rejects a slow operation with TimeoutError (bounds the wait)', async () => {
    await expect(withTimeout(() => sleep(500).then(() => 'late'), 50, 'slow')).rejects.toBeInstanceOf(TimeoutError);
  });
  it('resolves a fast operation and propagates its value', async () => {
    await expect(withTimeout(() => Promise.resolve(42), 100)).resolves.toBe(42);
  });
  it('propagates the operation\'s own error unchanged', async () => {
    await expect(withTimeout(() => Promise.reject(new Error('boom')), 100)).rejects.toThrow('boom');
  });
});

describe('withRetry', () => {
  it('succeeds after transient failures, within the attempt cap', async () => {
    let n = 0;
    const result = await withRetry(
      async () => {
        n += 1;
        if (n < 3) throw new Error('transient');
        return 'ok';
      },
      { attempts: 3, baseMs: 1 },
    );
    expect(result).toBe('ok');
    expect(n).toBe(3);
  });
  it('gives up after exhausting attempts (bounded, not infinite)', async () => {
    let n = 0;
    await expect(
      withRetry(async () => { n += 1; throw new Error('always'); }, { attempts: 2, baseMs: 1 }),
    ).rejects.toThrow('always');
    expect(n).toBe(3); // 1 initial + 2 retries
  });
  it('does not retry when shouldRetry says no', async () => {
    let n = 0;
    await expect(
      withRetry(async () => { n += 1; throw new Error('4xx'); }, { attempts: 5, baseMs: 1, shouldRetry: () => false }),
    ).rejects.toThrow('4xx');
    expect(n).toBe(1);
  });
});

describe('Bulkhead', () => {
  it('caps concurrency at maxConcurrent', async () => {
    const bh = new Bulkhead({ name: 't', maxConcurrent: 2, maxQueue: 10 });
    let active = 0;
    let peak = 0;
    const task = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(20);
      active -= 1;
    };
    await Promise.all(Array.from({ length: 6 }, () => bh.run(task)));
    expect(peak).toBe(2);
  });

  it('rejects fast with BulkheadFullError when concurrency + queue are saturated', async () => {
    const bh = new Bulkhead({ name: 't', maxConcurrent: 1, maxQueue: 0 });
    const busy = bh.run(() => sleep(50).then(() => 'a')); // holds the only slot
    await expect(bh.run(() => Promise.resolve('b'))).rejects.toBeInstanceOf(BulkheadFullError);
    await expect(busy).resolves.toBe('a'); // and the in-flight call still completes
  });
});

describe('CircuitBreaker composed with timeout/bulkhead (no cascade)', () => {
  it('a slow+erroring dependency is bounded: times out, then the breaker opens and short-circuits', async () => {
    const t = 0;
    const breaker = new CircuitBreaker({ name: 'dep', threshold: 2, cooldownMs: 1000, now: () => t });
    const slowDep = () => withTimeout(() => sleep(500), 20, 'dep'); // always times out within 20ms

    await expect(breaker.exec(slowDep)).rejects.toBeInstanceOf(TimeoutError);
    await expect(breaker.exec(slowDep)).rejects.toBeInstanceOf(TimeoutError);
    expect(breaker.currentState).toBe('OPEN');

    // Now calls short-circuit instantly (no 500ms wait) — bounded failure, not a cascade.
    await expect(breaker.exec(slowDep)).rejects.toBeInstanceOf(CircuitOpenError);
  });
});
