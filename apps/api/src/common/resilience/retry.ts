/**
 * Bounded retry with exponential backoff + jitter (Phase 7.1). Retries are CAPPED so a flapping
 * dependency can't loop forever; `shouldRetry` skips retries for errors that won't get better (e.g. a
 * 4xx / validation error).
 */
export interface RetryOptions {
  attempts?: number; // retries AFTER the first try (default 2 → up to 3 total)
  baseMs?: number;
  label?: string;
  shouldRetry?: (err: unknown) => boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(work: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 2;
  const base = opts.baseMs ?? 100;
  let lastErr: unknown;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await work();
    } catch (err) {
      lastErr = err;
      const canRetry = i < attempts && (opts.shouldRetry ? opts.shouldRetry(err) : true);
      if (!canRetry) throw err;
      await sleep(base * 2 ** i + Math.floor(Math.random() * base));
    }
  }
  throw lastErr;
}
