# ADR-009 — Per-Tenant Feature Entitlements (modules companies can add/remove)

**Status:** Accepted · **Date:** 2026-06-10 · **Deciders:** MetaXperts engineering

## Context

Companies (tenants) must be able to **add or remove ERP features to match their needs** — one tenant
runs HR + Finance only, another runs the full suite. This must be enforced server-side (not just
hidden in the UI), reflected in the UI (nav and routes adapt), and changeable at runtime without a
deploy. It is a cross-cutting concern (touches every module, auth, and the web shell), so it is
decided up front like tenancy and security.

## Decision

A **module registry + per-tenant entitlements** system.

1. **Module registry (static, in code):** every feature is declared as a `FeatureModule` with a
   stable `key` (e.g. `hr`, `finance`, `inventory`, `crm`, `reporting`, `notifications`), a display
   name, optional `dependsOn` keys, and a list of fine-grained sub-feature flags (e.g.
   `finance.invoicing`, `finance.double_entry`). The registry is the single source of truth for
   "what features exist".

2. **Entitlements (per tenant, in DB):** a `tenant_feature_entitlement` table (tenant-scoped, RLS)
   records which module/sub-feature keys are **enabled** for a tenant, with an `enabled` boolean and
   optional config JSON. Defaults come from **plan templates** (e.g. `starter`, `business`,
   `enterprise`) applied at tenant provisioning; admins toggle features afterward.

3. **Enforcement (backend):** a `@RequiresFeature('finance.invoicing')` decorator + `FeatureGuard`
   rejects requests to disabled features with a typed problem+json (403/404). Feature state is read
   from a cached `FeatureService` (cache invalidated on toggle). This composes with the RBAC guards
   (ADR-006) — a request must pass auth, tenant scope, role/permission, **and** feature entitlement.

4. **Reflection (frontend):** the web app fetches the tenant's enabled feature set (`GET
   /tenant/features`) and renders only enabled modules in the nav/routes (ADR-008). The UI never
   relies on hiding alone for security — the backend guard is authoritative.

5. **Auditability:** toggling a feature writes an audit-log entry (ADR-006 audit trail).

## Consequences

- One codebase serves every company with a per-tenant feature surface — true SaaS multi-tenancy of
  *capabilities*, not just data.
- Security is defense-in-depth: disabled features are unreachable at the API even if the UI is bypassed.
- Adds a registry + table + guard + cache; plan templates keep provisioning simple.
- Implementation lands alongside tenancy/RBAC (Phase 2): the registry + guard scaffolding with the
  security core, entitlement toggling with tenant provisioning, and UI reflection with the web shell.
