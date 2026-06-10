# ADR-004 — Reliable Eventing (Outbox + Idempotent Consumers + DLQ)

**Status:** Accepted · **Date:** 2026-06-10

## Context

Modules emit domain events (`inventory.low_stock`, `finance.invoice_paid`, `crm.deal_closed`, `hr.employee_created`) that drive the worker, notifications, reporting, and realtime updates. The dangerous anti-pattern is the **dual-write**: committing a business change to the DB and then publishing to the broker as two separate operations. If the process dies between them, you either lose the event (committed write, no publish) or emit a phantom event (publish, then write rolls back). Network glitches and redeliveries make naive consumers double-apply effects.

## Decision

**Transactional outbox** for publishing, **idempotent consumers** for delivery, **DLQ** for failures.

**Publish side (outbox):**
- In the *same DB transaction* as the business write, insert an `outbox_event` row (`id, tenantId, type, payload, occurredAt, publishedAt NULL, attempts`).
- A separate **relay** polls unpublished rows (`FOR UPDATE SKIP LOCKED`), publishes to the broker, and stamps `publishedAt`. No handler ever calls `publish()` inline during request processing.
- Crash between publish and stamp is tolerated because consumers dedupe.

**Delivery side (idempotent consumer):**
- Begin tx → check `processed_event(eventId)` → if seen, ack & return → else apply effect + insert `processed_event` → commit → ack.
- Redelivery is therefore safe (effect applied exactly once).

**Failure handling:**
- Retry with **exponential backoff + jitter**; after N attempts → **dead-letter queue**.
- Malformed/poison messages → DLQ immediately with a reason, never an infinite retry loop.
- `/admin/dlq` (TENANT_ADMIN) inspects and requeues.

**Contracts:** versioned (`domain.event.vN`) in `packages/shared/events`; breaking changes add `.v(N+1)` and run both until consumers migrate (see ADR-007 for envelope).

## Consequences

- At-least-once delivery + consumer idempotency = effectively exactly-once *effects*.
- An outbox table and a relay process must be operated and monitored (`outbox_lag`, `dlq_depth` metrics in Phase 8).
- Slightly higher write cost per event (one extra row) — accepted for guaranteed delivery.
- The broker being briefly down does not lose events; they accumulate in the outbox and drain on recovery.
