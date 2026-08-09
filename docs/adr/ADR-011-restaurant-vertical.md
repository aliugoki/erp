# ADR-011 — Restaurant vertical (module, not a separate stack) + dynamic fiscalization

**Status:** Accepted · **Date:** 2026-07-21 · **Deciders:** MetaXperts engineering

## Context

We must deliver an enterprise Restaurant Management System (POS, floor plan, kitchen display, recipes,
delivery, reservations, analytics) that manages restaurant chains — fine dining, QSR, café, cloud
kitchen, food court, franchise, hotel F&B, buffet, drive-thru, delivery-only — at a target scale of
10,000+ branches and 500,000+ orders/day. The system must **integrate with this ERP** (shared finance
GL, inventory ledger, HR, CRM, tax, auth, tenancy) and also be **sellable standalone**. It must also
integrate restaurant POS with Pakistani tax authorities, specifically **PRA (Punjab Revenue
Authority)**, and the authority choice must be **dynamic** (per tenant/branch).

An initial brief proposed a separate stack (FastAPI + React/Vite + Kafka + microservices). That is
incompatible with the integration requirement: it would not share auth, tenancy/RLS, the GL, or the
inventory ledger, turning "integration" into a second product bridged by brittle cross-service calls.

## Decision

1. **The RMS is a vertical business module inside `apps/api`**, modelled on the `pharmacy` and `pos`
   verticals — NestJS, TypeORM raw-SQL through the tenant-scoped transaction, RLS on every table,
   integer-minor-unit money, outbox for all side-effects. It reuses `inventory` (valued ledger =
   COGS), `finance` (GL via a settlement consumer), `crm` (guest = customer), `hr` (staff = employee),
   `branches` (location = branch), `tax`, `notifications`, `realtime`, `ai`, `storage`. It **never**
   re-implements these. The brief's separate stack is rejected (ADR-001 single-runtime core stands).

2. **Two shipping shapes, one codebase.** *Integrated* = restaurant alongside the full ERP.
   *Standalone* = the same deployment with only `restaurant` + hard deps (`inventory`, `finance`,
   `crm`) entitled via a plan template (ADR-009). No fork.

3. **One configurable order engine covers all restaurant formats** via per-branch `service_model` and
   `channels[]` flags, not eleven bespoke apps. The order lifecycle is a single state machine
   (`DRAFT→PLACED→CONFIRMED→[KDS ticket states]→SETTLED→CLOSED`, with `VOID`/`REFUNDED`).

4. **Hybrid clients.** All business logic and integration live in the NestJS module. Customer
   touchpoints (waiter tablet, driver, manager) ship as **Flutter** apps, and customer QR ordering as a
   web app, all thin clients over the ERP REST + WebSocket API. The admin dashboard is Next.js
   (ADR-008). Clients hold no business rules.

5. **Dynamic fiscalization via a provider registry.** Fiscal reporting is a `FiscalProvider` interface
   with per-authority implementations (`PraClient`, `FbrClient` [reused], `SrbClient`, `KpraClient`,
   `NullClient`). A tenant/branch `restaurant_fiscal_config` row selects
   `authority ∈ {PRA,FBR,SRB,KPRA,BRA,NONE}` + `environment` + credentials at **runtime** — switching
   authority is a config write, no deploy. Each provider does a bounded live call (timeout + retry)
   when production credentials exist and a flagged sandbox simulation otherwise (the pattern
   `FbrClient` already uses). A `RestaurantFiscalConsumer` reports on `restaurant.bill.settled`,
   idempotent per bill. The existing FBR integration is registered as one provider, not duplicated.

## Consequences

- Restaurant orders automatically produce GL vouchers, inventory consumption/COGS, customer ledger and
  loyalty, and fiscal invoices — because they flow through the ERP's existing engines, not parallel
  ones. One source of truth for money and stock.
- Provincial service-tax compliance (PRA and siblings) is a per-branch configuration, so one chain
  operating across provinces reports each branch to the correct authority with no code branching.
- Scale is handled with the platform's existing levers (PgBouncer, Redis read models, outbox/RabbitMQ,
  monthly partitioning of order/KDS tables, materialized-view reporting) rather than a new runtime.
- Cost: the RMS is bound to the ERP's conventions and release train. That is the intended trade — it is
  the only way "integrate with every ERP module" is true rather than aspirational.
- Supersedes nothing; extends ADR-009 (adds the `restaurant` feature module) and relies on
  ADR-001/002/004/005/007/010. If provincial e-invoicing APIs demand a dedicated runtime later, that is
  a new ADR, not silent drift.
