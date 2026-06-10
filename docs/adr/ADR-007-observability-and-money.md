# ADR-007 — Observability & Money Representation

**Status:** Accepted · **Date:** 2026-06-10

## Context

Two unrelated decisions that are both easy to get wrong early and painful to retrofit: how requests are traced across services, and how monetary amounts are stored. A request that fans out across API → broker → worker → ML is impossible to debug without correlated traces. And representing money as a floating-point number is a classic, silent data-integrity bug — `0.1 + 0.2 !== 0.3`, rounding drift accumulates across millions of journal entries.

## Decision

**Observability:**
- **OpenTelemetry** trace context propagates across every hop — HTTP *and* the message broker (inject on publish, extract on consume) — so one user action yields one connected trace (api → broker → worker → ml).
- Logs are **structured JSON** carrying `traceId`, `tenantId`, `userId`, `requestId` on every line.
- Metrics are Prometheus-exposed (`/metrics`): RED (rate/errors/duration) + USE, plus domain metrics `active_tenants`, `queue_depth`, `outbox_lag`, `dlq_depth`, `breaker_state`.
- Exported to the otel-collector defined in `infra` from the start.

**Money:**
- Stored as **integer minor units + ISO-4217 currency code**: `{ amountMinor: integer, currency: string }`. Never a float, never a JS `number` representing major units.
- All arithmetic is integer arithmetic on `amountMinor`. Formatting to "Rs. 1,234.56" happens only at the presentation edge.
- **PKR is the default** currency; the type is currency-aware so Gulf-market currencies (AED, SAR, QAR) are first-class.
- Mixed-currency operations are explicit (no implicit conversion); journal entries balance on integer minor units (the debit==credit invariant in chunk 3.2 asserts on integers).

## Consequences

- Production incidents are debuggable across the whole distributed flow from one trace id.
- Financial correctness is structural, not a matter of remembering to round — the type makes floats unrepresentable.
- A small amount of edge formatting/parsing code is needed (minor↔major) — centralized in `packages/shared` (the `Money` type and helpers).
- Trace propagation across the broker requires the publish/consume layer to carry context headers — built into the EventBus (chunk 4.2) and verified in chunk 8.1.
