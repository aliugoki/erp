# Scope — Per-tenant business-rule / validation policy engine

**Status:** Proposal (next effort after the reporting export engine) · **Author:** platform

Companies want to **configure business rules per module without code changes** — limits, required
fields, document numbering, credit limits, reorder thresholds, approval thresholds, etc. This scopes a
shared, per-tenant **policy engine** that modules consult at decision points.

## Principle

One central engine (like the feature-entitlement and permission engines already in the codebase), not
a bespoke rule system copy-pasted per module. A policy is a **typed, per-tenant, namespaced setting**
with a schema, a default, and an enforcement hook.

## Model

- `tenant_policy(tenant_id, key, value jsonb, updated_by, updated_at)` — RLS-scoped, like
  `tenant_feature_entitlement`. `key` is `domain.policy` (e.g. `finance.voucher_approval_threshold_minor`).
- A **policy registry** in code (`PolicyCatalog`) — each entry declares: key, label, group/module,
  value type + schema (number / money / boolean / enum / string / list), default, and help text.
  This is the source of truth and drives the admin UI (like the permission catalog).
- `PolicyService.get(tenantId, key)` (Redis-cached, short TTL + invalidation) returns the effective
  value (tenant override ∨ registry default). `assert(...)`/`check(...)` helpers for enforcement.
- Company-admin CRUD at `/tenant/policies` (TENANT_ADMIN; values validated against the registry
  schema), with a **Settings → Policies** UI grouped by module.

## Policy kinds (initial catalog)

- **Limits / thresholds** — approval thresholds (PO, voucher, discount, leave days), max line items,
  credit limit per customer, min margin %.
- **Required-field / validation toggles** — require cost-center on vouchers, require PO for bills,
  require batch/expiry on pharmacy receipts, enforce reorder level.
- **Numbering** — document number format/prefix/sequence per type (where not already fixed).
- **Behavioral switches** — allow negative stock, allow backdated vouchers, auto-post on approval.

Each enforced at the module's service decision point: `PolicyService.assert(tenantId, key, context)`
throws an RFC-7807 error when violated (never UI-only).

## Phases

- **A — Engine + catalog. ✅ SHIPPED.** `tenant_policy` migration (RLS); `PolicyService` (Redis-cached
  effective value = override ∨ default, with `get/getNumber/getBool` for module use + `set/reset` +
  audit); `policy-catalog.ts` registry seeded with 9 policies across Finance/Inventory/Sales-CRM/POS/
  HR/Pharmacy (typed, schema-validated, defaults = today's behaviour); `/tenant/policies` CRUD
  (TENANT_ADMIN); **Settings → Policies** UI grouped by module (Switch / number / money / enum
  controls + reset). No enforcement yet (config-only, non-breaking). Live-proven: set/reset/validation
  /admin-only all correct.
- **B — Enforce, module by module.** ▶ IN PROGRESS. Wire `PolicyService` reads into each module's
  decision points (one PR per module group). Defaults are no-ops, so enforcement only bites once a
  tenant overrides.
  - ✅ **Finance** — `finance.voucher_approval_threshold_minor` (post-above-threshold must be a draft
    for a second approver) **and** `finance.require_cost_center` (every voucher line needs a cost
    centre); both in `createTransaction` (automated `postJournalInTx` exempt). Live-proven.
  - ✅ **HR** — `hr.max_leave_days_per_request`: a leave request longer than the cap is rejected
    (`createLeaveRequest`). Live-proven.
  - ✅ **POS** — `pos.max_discount_percent`: a line whose discount % exceeds the cap is rejected
    (`createSale`). Live-proven.
  - 🏷 The catalog now carries an `enforced` flag; the **Settings → Policies** UI tags any policy not
    yet wired as "not enforced yet" so an admin is never misled by a no-op toggle.
  - ✅ **Inventory `allow_negative_stock`** (dedicated PR). Migration `1726600000000` drops the hard
    `CHECK (on_hand >= 0)`; the two on-hand decrement paths (`InventoryService.createMovement`,
    `InventoryDocsService.postLedger` — the shared valued-ledger backbone behind GRN/issue/POS/
    production) now app-gate oversell on the policy. WAVG already handled non-positive qty (value→0,
    last cost retained). Pharmacy's separate `ck_pharmacy_lot_qty` is untouched. Live-proven: default
    blocks oversell, enabling drives on-hand to -5, reset blocks again.
  - ✅ **Finance `require_po_for_bill`** + **`crm.discount_cap_percent`** (added backing fields:
    `vendor_bill.po_ref`; `sales_*_line.discount_percent`, which also folds into the line total).
    Live-proven (bill blocked w/o PO; quote line blocked above cap, 5% folds to subtotal 1900).
  - ☐ **`sales.customer_credit_limit_minor`** — not a field but an **AR-outstanding model**: needs a
    customer-balance aggregation (unpaid invoices/orders) + a credit-vs-cash distinction at order time.
    Its own design + PR.
  - ☐ **`pharmacy.block_expired_dispense`** — relaxation-type (default already blocks); like
    negative-stock it means relaxing an existing hard guard — its own PR if wanted.
- **C — Approval workflows (optional, larger).** If thresholds need multi-step maker–checker routing
  beyond the existing finance maker/checker, model `approval_request` + routing rules. Separate scope.

## Risks

- A wrong default could block legitimate operations → registry defaults must match today's behavior
  (no enforcement change until a tenant opts in); ship Phase A as pure config first.
- Per-request policy lookups on hot paths → Redis-cached like features/permissions.
- Scope creep — "configurable everything" is unbounded. Seed a deliberate, high-value catalog; grow
  on demand.

## Relationship to existing engines

Complements ADR-009 (feature entitlements: *which modules*) and ADR-010 (permissions: *who can act*).
This engine governs *how* an action must be shaped — the third axis of per-tenant configuration. On
acceptance this becomes **ADR-011**.
