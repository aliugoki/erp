/**
 * @metaxperts/shared — cross-app contracts.
 *
 * These types are the wire contracts shared by api, web, and worker. Keep them framework-agnostic:
 * no NestJS, no Next, no runtime dependencies. Runtime helpers here must stay tiny and pure.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Result envelope (ADR-/CLAUDE conventions): success is always { data, meta }.
// ─────────────────────────────────────────────────────────────────────────────

/** Pagination metadata returned in `meta` for list endpoints. */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Generic response metadata. Lists set `pagination`; other meta fields may be added over time. */
export interface ResponseMeta {
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

/** The success envelope wrapping every non-error API response. */
export interface SuccessEnvelope<T> {
  data: T;
  meta?: ResponseMeta;
}

/** Build a success envelope. */
export function ok<T>(data: T, meta?: ResponseMeta): SuccessEnvelope<T> {
  return meta ? { data, meta } : { data };
}

/** Compute pagination meta from total + page params. */
export function paginationMeta(total: number, page: number, pageSize: number): PaginationMeta {
  const safeSize = pageSize > 0 ? pageSize : 1;
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / safeSize)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error envelope: RFC 7807 problem+json.
// ─────────────────────────────────────────────────────────────────────────────

/** RFC 7807 `application/problem+json` body. */
export interface Problem {
  /** A URI reference identifying the problem type. Defaults to "about:blank". */
  type: string;
  /** A short, human-readable summary of the problem type. */
  title: string;
  /** The HTTP status code. */
  status: number;
  /** A human-readable explanation specific to this occurrence. */
  detail?: string;
  /** A URI reference identifying the specific occurrence (usually the request path). */
  instance?: string;
  /** Trace id correlating this error to logs/traces. */
  traceId?: string;
  /** Field-level validation errors, when applicable. */
  errors?: Record<string, string[]>;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

// ─────────────────────────────────────────────────────────────────────────────
// Money (ADR-007): integer minor units + ISO-4217 currency. NEVER floats.
// ─────────────────────────────────────────────────────────────────────────────

/** Money is always integer minor units (e.g. paisa, cents) plus an ISO-4217 currency code. */
export interface Money {
  /** Amount in the currency's minor unit (integer). e.g. 12345 == 123.45 of a 2-decimal currency. */
  amountMinor: number;
  /** ISO-4217 currency code, e.g. "PKR", "USD". */
  currency: string;
}

export const DEFAULT_CURRENCY = 'PKR';

/** Construct a Money value, asserting the amount is an integer (no floats for money). */
export function money(amountMinor: number, currency: string = DEFAULT_CURRENCY): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`Money.amountMinor must be an integer (minor units), got ${amountMinor}`);
  }
  return { amountMinor, currency };
}

/** Add two Money values of the same currency. Throws on currency mismatch. */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot add Money of different currencies: ${a.currency} vs ${b.currency}`);
  }
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

// ─────────────────────────────────────────────────────────────────────────────
// Base event contract (ADR-004): the shape every domain event shares.
// Versioned, concrete contracts (e.g. inventory.low_stock.v1) are added in Phase 4.
// ─────────────────────────────────────────────────────────────────────────────

/** The envelope every domain event shares. `type` is a versioned id like "domain.event.vN". */
export interface BaseEvent<TPayload = unknown> {
  /** Unique event id (UUID) — consumers dedupe on this for idempotency. */
  id: string;
  /** Versioned event type, e.g. "inventory.low_stock.v1". */
  type: string;
  /** Owning tenant (every event is tenant-scoped). */
  tenantId: string;
  /** When the event occurred (ISO-8601 UTC). */
  occurredAt: string;
  /** The event-specific payload. */
  payload: TPayload;
}
