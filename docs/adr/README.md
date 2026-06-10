# Architecture Decision Records — MetaXperts ERP

These ADRs are **binding**. They are referenced in the PRE-FLIGHT of every build chunk and exist so cross-cutting choices are made once, up front — not retrofitted after modules are built.

Format: Context → Decision → Consequences → Status. An ADR is only changed by writing a new ADR that supersedes it (never by editing an applied one).

| ADR | Title | Status |
|---|---|---|
| [001](ADR-001-stack-and-polyglot-scope.md) | Stack & polyglot scope | Accepted |
| [002](ADR-002-multi-tenancy.md) | Multi-tenancy via shared schema + Postgres RLS | Accepted |
| [003](ADR-003-persistence-and-migrations.md) | Persistence & migrations | Accepted |
| [004](ADR-004-reliable-eventing.md) | Reliable eventing (outbox + idempotent consumers + DLQ) | Accepted |
| [005](ADR-005-cross-cutting-base.md) | Cross-cutting base entity & scoped repository | Accepted |
| [006](ADR-006-security-boundaries.md) | Security boundaries | Accepted |
| [007](ADR-007-observability-and-money.md) | Observability & money representation | Accepted |
| [008](ADR-008-ui-ux-stack.md) | UI/UX stack (enterprise, open-source, themeable) | Accepted |
| [009](ADR-009-feature-entitlements.md) | Per-tenant feature entitlements (add/remove modules) | Accepted |
