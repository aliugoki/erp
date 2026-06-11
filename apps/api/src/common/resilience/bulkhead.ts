/**
 * A bulkhead (Phase 7.1): caps the number of concurrent in-flight calls to one dependency, with a
 * bounded waiting queue. When both are saturated it rejects fast ({@link BulkheadFullError}) rather
 * than queueing unboundedly — so a slow dependency can't pile up requests and starve the rest of the
 * process (threads, memory, the DB pool). One bulkhead per dependency = isolated failure domains.
 */
export class BulkheadFullError extends Error {
  constructor(name: string) {
    super(`bulkhead "${name}" is full`);
    this.name = 'BulkheadFullError';
  }
}

export interface BulkheadOptions {
  name: string;
  maxConcurrent: number;
  maxQueue?: number; // additional callers allowed to WAIT for a slot (default 0 = reject when busy)
}

export class Bulkhead {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly opts: BulkheadOptions) {}

  get inFlight(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiters.length;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.opts.maxConcurrent) {
      if (this.waiters.length >= (this.opts.maxQueue ?? 0)) {
        throw new BulkheadFullError(this.opts.name);
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}
