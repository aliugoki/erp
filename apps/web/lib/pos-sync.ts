'use client';
import { ApiError, apiPost } from '@/lib/api';
import { getQueue, removeQueued, updateQueued } from '@/lib/pos-offline';

/**
 * Replay queued offline sales to the server. Each carries its Idempotency-Key, so the server processes
 * it exactly once even if a prior attempt already landed. A business rejection (4xx, e.g. the
 * reconcile-time stock check) parks the sale in the `error` bucket for manual review rather than
 * retrying forever; network errors / 5xx / 409-in-progress are left pending to retry next time.
 */
export async function syncQueue(): Promise<{ synced: number; failed: number; remaining: number }> {
  let synced = 0;
  let failed = 0;
  for (const e of getQueue()) {
    if (e.status !== 'pending') continue;
    try {
      await apiPost('/pos/sales', e.payload, { idempotencyKey: e.key });
      removeQueued(e.key);
      synced++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 409) {
        updateQueued(e.key, { status: 'error', error: err.message });
        failed++;
      }
      // else: transient (offline again / 5xx / in-flight) — keep pending
    }
  }
  return { synced, failed, remaining: getQueue().filter((x) => x.status === 'pending').length };
}
