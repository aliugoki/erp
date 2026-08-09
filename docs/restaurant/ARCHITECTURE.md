# Restaurant Management System (RMS) — Architecture & Build Plan

> **Status:** Phase 1 (Architecture + Schema). **Owner:** MetaXperts engineering.
> This document is the anchor for the Restaurant vertical. It is subordinate to the root
> `CLAUDE.md` constitution and the ADRs in `docs/adr/`. Where this document and an ADR disagree,
> **the ADR wins** (see ADR-011 for the restaurant-specific decisions).

---

## 1. What this is (and is not)

The RMS is a **vertical business module** of the MetaXperts ERP — modelled exactly on the existing
`pharmacy` and `pos` verticals. It is **not** a standalone POS and **not** a separate microservice
stack. It lives in `apps/api/src/modules/restaurant`, reuses the ERP's platform (auth, tenancy/RLS,
outbox, finance GL, inventory ledger, HR, CRM, tax, notifications, realtime, AI), and is gated by a
per-tenant `restaurant` feature entitlement (ADR-009).

**Two shipping shapes, one codebase:**
- **Integrated** — one tenant runs Restaurant alongside HR/Finance/Inventory/CRM. Orders post to the
  shared GL, deduct the shared inventory ledger, bill shared CRM customers, and staff are shared HR
  employees. This is the default and the reason we did not build a second stack.
- **Standalone** — the same ERP deployed with only `restaurant` (+ its hard dependencies
  `inventory`, `finance`, `crm`) entitled via a plan template. No code fork; a trimmed feature
  surface. This satisfies the "also sell standalone" requirement.

The brief's original stack (FastAPI / React-Vite / Kafka / microservices) was **rejected** because it
cannot integrate with this ERP (no shared auth, GL, inventory, or tenancy). The RMS instead follows
the ERP stack: **NestJS** API, **Next.js 14** web, **RabbitMQ** + transactional outbox, Postgres 16 +
RLS, Redis, MinIO, Python FastAPI ML service. See ADR-011 §Decision.

**Hybrid client decision:** business logic and all integration live in the NestJS module; the customer
touchpoints (waiter tablet, customer QR, driver, manager) are delivered as **Flutter apps** that
consume the ERP REST + WebSocket API. The web dashboard is Next.js (ADR-008). Flutter apps hold **no**
business rules — they are thin clients over the API.

---

## 2. Restaurant types supported (one configurable engine)

A single engine with per-branch `service_model` configuration covers every format in the brief. We do
**not** build eleven apps — we build one order lifecycle with mode flags:

| Format | How it is modelled |
|---|---|
| Fine dining | Dine-in sessions, table/floor plan, coursing, tableside modifiers |
| Fast food / QSR | Counter orders, no table, ticket-first |
| Café | Counter + optional tables |
| Cloud / ghost kitchen | Delivery-only channel; no floor plan; KDS + delivery only |
| Food court | Multiple branches under one company sharing a floor space; per-stall order routing |
| Multi-branch / franchise | Company → branches (existing `branches` module); per-branch menus, pricing, entitlements |
| Hotel restaurant | Room-charge payment method → posts to a folio (future Hotel module hook) |
| Buffet | Cover-based pricing (price per guest) instead of per-item |
| Drive-thru | Ordered lane + KDS bump; `channel = DRIVE_THRU` |
| Delivery-only | `channel = DELIVERY`; own delivery + aggregator integrations |

`service_model ∈ {DINE_IN, QSR, CAFE, CLOUD_KITCHEN, FOOD_COURT, BUFFET, DRIVE_THRU}` and
`channels[] ⊆ {DINE_IN, TAKEAWAY, DELIVERY, DRIVE_THRU, AGGREGATOR}` on the branch config drive UI and
routing without code changes.

---

## 3. Integration map — reuse, never duplicate

Every arrow is an existing ERP capability the RMS **consumes**. Nothing below is re-implemented.

```
                         ┌──────────────────────────────────────────────┐
                         │            RESTAURANT vertical                │
                         │  menu · floor · orders · KDS · recipes ·      │
                         │  delivery · reservations · fiscalization      │
                         └──────────────────────────────────────────────┘
   auth / RBAC / features ──▶ every request guarded + @RequiresFeature('restaurant')
   tenancy (RLS)          ──▶ every table tenant-scoped via TenantTransactionService
   branches               ──▶ each restaurant location IS an ERP branch
   inventory ledger       ──▶ recipe explosion deducts inventory_product stock (weighted-avg COGS)
   finance GL             ──▶ order settlement posts revenue / tax / COGS / cash via a GL consumer
   tax (FBR/PRA/…)        ──▶ dynamic fiscalization provider (see §7)
   crm (customer)         ──▶ guest = ERP customer; loyalty, history, marketing
   hr (employee)          ──▶ waiter/chef/driver/cashier = ERP employee; attendance, payroll, tips
   notifications          ──▶ order-ready, driver-assigned, reservation reminders (email/in-app/SMS)
   realtime (WS)          ──▶ KDS + waiter + customer live updates
   ai (ml FastAPI)        ──▶ demand forecast, prep-time, upsell, waste, dynamic pricing
   outbox → RabbitMQ      ──▶ every domain side-effect (§6) — never inline publish
   storage (MinIO)        ──▶ menu photos/videos, receipts, KDS attachments
   reporting              ──▶ cross-module dashboards (sales, food cost, table turnover)
```

**COGS/inventory:** the RMS does **not** own stock. A menu item maps to a **recipe** (bill of
materials of `inventory_product`s with yield/waste). On order completion the recipe is exploded and the
existing inventory ledger is decremented — the same valued ledger pharmacy/POS use, so there is exactly
one source of stock truth and COGS is weighted-average, automatically.

**GL:** settlement emits `restaurant.bill.settled`; a `restaurant-gl.consumer` posts the double-entry
voucher via `FinanceService` using accounts from `restaurant_gl_config` (revenue, tax payable, COGS,
inventory, cash/bank/card clearing, discount, tips payable, rounding). Mirrors `pharmacy-gl.consumer`.

---

## 4. Module layout (NestJS, mirrors pharmacy)

```
apps/api/src/modules/restaurant/
  dto/restaurant.dto.ts
  restaurant.module.ts              # imports InventoryModule, FinanceModule, CrmModule, TaxModule…
  restaurant.controller.ts          # @Controller('restaurant') @RequiresFeature('restaurant')
  menu.service.ts                   # categories, items, modifier groups, combos, per-branch pricing
  floor.service.ts                  # areas, tables, status, merge/split
  order.service.ts                  # the order lifecycle (the heart)
  kds.service.ts                    # station routing, ticket state machine, bump
  recipe.service.ts                 # recipe BOM ↔ inventory_product; explosion on completion
  delivery.service.ts               # own delivery: driver assign, tracking, OTP; aggregator webhooks
  reservation.service.ts            # booking, waitlist, QR check-in
  fiscal/                           # dynamic tax-authority fiscalization (§7)
    fiscal.service.ts
    fiscal-provider.interface.ts
    providers/pra.client.ts fbr.client.ts srb.client.ts kpra.client.ts null.client.ts
    restaurant-fiscal.consumer.ts
  restaurant-gl.util.ts / .consumer.ts   # GL posting on settlement
  restaurant-reports.service.ts
  *.spec.ts
```

Register in `app.module.ts` and `feature-registry.ts` (done in Phase 1). Realtime channels are added to
the existing `realtime` gateway; ML calls go through the existing `ai` module client.

---

## 5. The order lifecycle (single state machine, all formats)

```
DRAFT → PLACED → CONFIRMED → (per KDS ticket: QUEUED → PREPARING → READY → SERVED/BUMPED)
      → SETTLED → CLOSED            (VOID / REFUNDED are terminal side-branches)
```

- **Order** = the guest's tab (a dine-in table session, a QSR ticket, a delivery job, a drive-thru lane).
- **Order item** carries modifiers (extra cheese / no onion / spice level / doneness), kitchen notes,
  course number, and a resolved unit price (per-branch menu price + modifier deltas).
- On `CONFIRMED`, items are **routed to KDS stations** by item→station rules (grill, fry, pizza, cold,
  bar, dessert, bakery). Each station gets its own **ticket**; one order can span many tickets.
- **READY** on all tickets → waiter/customer notified. **SETTLED** triggers payment split, fiscal
  report (§7), GL posting, inventory deduction, loyalty accrual — all via events (§6), never inline.

Concurrency & correctness: table status transitions and KDS bumps are guarded by row-level state checks
inside the tenant transaction (same `UnprocessableEntityException` pattern as pharmacy sales orders).

---

## 6. Event catalog (versioned contracts in `packages/shared`)

Every event is a versioned contract (`…V1`) added to `EVENT_TYPES`, emitted **only** through the
outbox, consumed idempotently. Non-exhaustive:

| Event | Emitted when | Key consumers |
|---|---|---|
| `restaurant.order.placed` | Guest/waiter places order | KDS routing, analytics |
| `restaurant.order.confirmed` | Order fired to kitchen | KDS ticket creation, printer |
| `restaurant.kds.ticket_ready` | A station bumps its ticket | waiter/customer notify, realtime |
| `restaurant.order.served` | All tickets served | analytics (table turnover) |
| `restaurant.bill.settled` | Payment completed | **GL post**, **inventory deduct**, **fiscal report**, loyalty |
| `restaurant.order.voided` / `.refunded` | Void/refund | GL reversal, fiscal void, stock reversal |
| `restaurant.delivery.assigned` | Driver assigned | notify customer + driver, tracking start |
| `restaurant.delivery.completed` | OTP-verified drop | GL cash-on-delivery, analytics |
| `restaurant.reservation.created` | Booking made | notification reminder schedule |
| `restaurant.inventory.low` (reuse `inventory` low-stock) | Recipe deduction crosses reorder | procurement PR suggestion (worker) |

Existing platform events reused: `pos.sale_completed` (when a restaurant sale is rung through POS),
`inventory.*`, `notification.*`.

---

## 7. Dynamic tax-authority fiscalization (FBR / PRA / SRB / KPRA / BRA)

**Requirement:** integrate RMS POS with **PRA (Punjab Revenue Authority)** — and the choice must be
**dynamic**, because a Pakistani restaurant's fiscal authority depends on the **province of the branch**
and whether the tax is on goods (federal FBR) or services (provincial). Restaurants are a **service**,
so most sit under a provincial authority:

| Authority | Scope | Restaurant relevance |
|---|---|---|
| **PRA** | Punjab | Punjab Sales Tax on Services — restaurants (RIMS e-invoicing) |
| **SRB** | Sindh | Sindh services sales tax |
| **KPRA** | Khyber Pakhtunkhwa | KP services sales tax |
| **BRA** | Balochistan | Balochistan services sales tax |
| **FBR** | Federal | Goods / POS Integration (already in the `tax` module) |
| **NONE** | — | No fiscal integration (non-PK tenants) |

**Design — a pluggable provider, selected per branch at runtime:**

1. `restaurant_fiscal_config` (tenant-scoped, optionally per `branch_id`) stores:
   `authority ∈ {PRA,FBR,SRB,KPRA,BRA,NONE}`, `environment ∈ {sandbox,production}`, registration
   number (PRA POS reg / NTN / STRN), `api_token` (secret via the `*_FILE`/secrets convention),
   `pos_id`, and provider-specific JSON. **Changing the authority is a config write — no deploy, no
   code change.** This is the "dynamic" requirement, mirroring how `FbrClient` already flips
   sandbox↔production on credentials alone.
2. `FiscalProvider` interface: `report(config, invoice) → { authorityInvoiceNo, qr, response }` and
   `void(config, ref)`. Implementations: `PraClient`, `FbrClient` (reuse the existing one),
   `SrbClient`, `KpraClient`, `NullClient`. Each does **live** calls with a bounded timeout + one retry
   when production credentials are present, and a clearly-flagged **sandbox** simulation otherwise — the
   exact contract `FbrClient` already implements, so the flow is always exercisable end-to-end.
3. `FiscalService.reportForBill(tenantId, branchId, billId)` loads the branch's config, picks the
   provider from a registry keyed by `authority`, builds the authority-specific payload, calls it, and
   stores `authority`, `authority_invoice_no`, `qr`, and the raw response on the settled bill. Printed
   receipts and the customer QR page render the returned number + QR.
4. `RestaurantFiscalConsumer` subscribes to `restaurant.bill.settled` (and `pos.sale_completed` when
   rung through POS), **idempotent per bill** so a redelivered event never double-reports. Failures go
   to retry/DLQ; a bill can be re-reported from the admin UI. This mirrors `FbrPosConsumer` exactly.

The existing FBR integration is **not duplicated** — it is registered as one provider in the same
registry, so FBR-goods and PRA-services can coexist for a mixed tenant.

---

## 8. Security, scalability, reliability (inherited, not re-invented)

- **Tenant isolation:** shared-schema + `tenant_id` + Postgres **RLS** on every restaurant table
  (ADR-002/005). Company A can never read Company B — enforced at the DB even on a forgotten `WHERE`.
- **AuthZ:** every endpoint guarded; permission-level RBAC (`@Permissions`, ADR-010); module gated by
  `@RequiresFeature('restaurant')` (ADR-009). New permissions: `restaurant.menu.manage`,
  `restaurant.order.ring`, `restaurant.kds.operate`, `restaurant.floor.manage`,
  `restaurant.delivery.dispatch`, `restaurant.reports.view`, `restaurant.fiscal.configure`.
- **Reliability:** every external call (ML, aggregator API, fiscal authority, SMS) has timeout + retry
  + failure path; every side-effect via outbox + idempotent consumer + DLQ (ADR-004).
- **Scale target (10k branches, 500k orders/day, millions of req/day):** stateless API behind
  PgBouncer; hot read models (KDS queue, live floor) served from Redis and pushed over WS; order and
  KDS tables **range-partitioned by month** and indexed `(tenant_id, branch_id, created_at)`; heavy
  reporting off materialized views refreshed by the worker. Aggregator/delivery webhooks are queued,
  not processed inline.
- **Money:** integer minor units, ISO-4217, never floats (ADR-007). Multi-currency per branch.

---

## 9. Phased build plan (chunk contract per root CLAUDE.md)

| Phase | Chunk | Deliverable | Gate |
|---|---|---|---|
| **1** | 1.1 | **Architecture + ADR-011 + feature registry** | this doc + ADR merged; `restaurant` key in registry; typecheck 0 |
| **2** | 2.1 | **Core schema** migration: config, gl_config, fiscal_config, doc_seq, menu, floor, tables, reservations | `migration:run` idempotent (run twice = no-op); RLS on every table |
| **2** | 2.2 | **Order/KDS/recipe/delivery schema** migration | idempotent; composite FKs to inventory_product/customer |
| **3** | 3.1 | Menu + floor services + DTOs + controller (CRUD) | unit tests green; endpoints guarded + feature-gated |
| **4** | 4.1 | Order lifecycle service + realtime + KDS routing | vertical slice: place→confirm→route→ready→serve |
| **4** | 4.2 | Recipe explosion → inventory deduction; settlement | order settles → inventory ledger moves; COGS computed |
| **4** | 4.3 | GL consumer (revenue/tax/COGS/cash) | settled bill posts a balanced voucher |
| **5** | 5.1 | **Dynamic fiscalization** (PRA + FBR + registry + consumer) | sandbox PRA report on settle; authority switchable via config |
| **6** | 6.1 | Delivery: own driver assign + tracking + OTP; aggregator webhook scaffolding | delivery lifecycle events fire + notify |
| **7** | 7.1 | Reservations + waitlist + QR check-in | booking → reminder scheduled |
| **8** | 8.1 | Next.js dashboard: floor designer, menu admin, KDS board, live sales | feature-reflected nav; realtime board |
| **9** | 9.x | **Flutter apps** (waiter, customer-QR web+app, driver, manager) | thin clients over API; QR-order → KDS demo |
| **10** | 10.x | AI: prep-time, demand forecast, upsell, waste, dynamic pricing (via `ai`/`apps/ml`) | ML-down graceful degradation |
| **11** | 11.x | Tests: unit + integration + acceptance (drives every event, asserts consumers) | acceptance script green |
| **12** | 12.x | Ops: seed demo restaurant tenant; dashboards; runbook entries | `seed-demo` idempotent; docker prod up |

Phase 1 lands: **this document, ADR-011, the feature-registry entry, and the first two schema
migrations** (2.1, 2.2 pulled forward since the user chose "schema first").

---

## 10. Open decisions carried forward
- Aggregator integrations (Foodpanda/Careem/Uber Eats/Talabat) — start with an inbound webhook +
  outbound status contract; real API credentials are per-tenant config, same sandbox/live pattern as
  fiscalization. Deep per-aggregator work is Phase 6+.
- Hotel room-charge settlement is stubbed as a payment method until a Hotel module exists.
- Kitchen printer: ESC/POS via a per-branch print agent subscribing to `restaurant.order.confirmed`.
