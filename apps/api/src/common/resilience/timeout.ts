/**
 * Bound the WAIT on any promise (Phase 7.1). The underlying work isn't cancelled (use an
 * AbortController where the API supports it, e.g. fetch); this guarantees the CALLER never blocks
 * longer than `ms`, so a hung dependency can't pin a request indefinitely.
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`"${label}" timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(work: () => Promise<T>, ms: number, label = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new TimeoutError(label, ms));
      }
    }, ms);
    work().then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      },
    );
  });
}
