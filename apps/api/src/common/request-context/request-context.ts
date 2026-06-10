import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request ambient state, carried via AsyncLocalStorage so any layer (services, repositories,
 * logger, exception filter) can read it without prop-drilling. Starts with `requestId`; tenancy
 * (Chunk 1.4) and auth (Phase 2) populate `tenantId` / `userId`, which then drive RLS and logging.
 */
export interface RequestStore {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

const als = new AsyncLocalStorage<RequestStore>();

export const RequestContext = {
  /** Run `fn` within a fresh request store. */
  run<T>(store: RequestStore, fn: () => T): T {
    return als.run(store, fn);
  },
  /** The current store, if inside a request. */
  get(): RequestStore | undefined {
    return als.getStore();
  },
  /** Merge fields into the current store (no-op outside a request). */
  set(patch: Partial<RequestStore>): void {
    const store = als.getStore();
    if (store) Object.assign(store, patch);
  },
  requestId(): string | undefined {
    return als.getStore()?.requestId;
  },
  tenantId(): string | undefined {
    return als.getStore()?.tenantId;
  },
  userId(): string | undefined {
    return als.getStore()?.userId;
  },
};
