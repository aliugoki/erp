/**
 * A minimal circuit breaker (Phase 7.1; originally built for the ML bridge in 6.5, now shared across
 * every remote dependency). Wraps a remote call so a failing dependency fails FAST once it's clearly
 * down, instead of hammering it (and tying up request threads) on every call.
 *
 * States:
 *  - CLOSED      — calls pass through; consecutive failures are counted.
 *  - OPEN        — `threshold` failures reached; calls short-circuit (throw {@link CircuitOpenError})
 *                  for `cooldownMs` without touching the remote.
 *  - HALF_OPEN   — after the cooldown, ONE trial call is allowed: success → CLOSED, failure → OPEN.
 *
 * `now` is injectable so cooldown/half-open transitions are deterministically testable.
 */
export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`circuit "${name}" is open`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  name: string;
  threshold: number;
  cooldownMs: number;
  now?: () => number;
}

export class CircuitBreaker {
  private state: BreakerState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;

  constructor(private readonly opts: CircuitBreakerOptions) {}

  get currentState(): BreakerState {
    return this.opts.now ? this.peek() : this.state;
  }

  /** State as observed now (accounts for an elapsed cooldown without requiring a call). */
  private peek(): BreakerState {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.opts.cooldownMs) return 'HALF_OPEN';
    return this.state;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.now() - this.openedAt < this.opts.cooldownMs) {
        throw new CircuitOpenError(this.opts.name);
      }
      this.state = 'HALF_OPEN'; // cooldown elapsed → allow one trial
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures += 1;
    if (this.state === 'HALF_OPEN' || this.failures >= this.opts.threshold) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }
}
