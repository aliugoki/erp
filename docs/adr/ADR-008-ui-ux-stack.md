# ADR-008 — UI/UX Stack (enterprise-grade, open-source, themeable)

**Status:** Accepted · **Date:** 2026-06-10 · **Deciders:** MetaXperts engineering

## Context

The product requirement is an **enterprise SaaS-grade** web experience — the polish of a commercial
ERP (Workday/SAP-class feel) — built **exclusively from open-source, self-hostable tooling** (no paid
component libraries, no proprietary design systems, no SaaS UI services). It must support **multiple
themes** (light/dark plus brandable palettes per company) and a customizable, feature-toggleable
layout (see ADR-009). The Chunk 1.1 web app is only a placeholder shell; this ADR fixes the stack so
the real UI is built consistently.

## Decision

`apps/web` is **Next.js 14 (App Router) + TypeScript**, styled and componentized with a
**code-owned, MIT-licensed** stack:

- **Tailwind CSS** — utility styling; design tokens as **CSS variables** so themes are swappable at
  runtime without rebuilds.
- **shadcn/ui** (Radix UI primitives + Tailwind) — accessible components copied **into the repo** (we
  own the code; no runtime dependency lock-in, fully customizable). MIT.
- **next-themes** — theme switching (light/dark/system + named brand themes).
- **lucide-react** — icon set (ISC/MIT).
- **TanStack Query** (server state) + **TanStack Table** (enterprise data grids) — MIT.
- **react-hook-form + zod** — forms + validation (zod shared with the API contracts). MIT.
- **Recharts** (and/or **Tremor**) — charts/dashboards. MIT/Apache-2.0.

**Theming model:** a base set of semantic design tokens (`--background`, `--foreground`, `--primary`,
`--radius`, …) defined per theme as CSS-variable sets; the active theme is a `data-theme` attribute on
`<html>`. Companies can select a shipped theme or define a brand palette. No hard-coded colors in
components — only token references.

**Layout shell:** persistent sidebar nav (driven by the tenant's enabled modules — ADR-009), top bar
with tenant/user/theme switchers, command palette, breadcrumb, and a responsive content area.

## Consequences

- 100% open-source and self-hostable; nothing to license or pay for.
- Owning the component source (shadcn/ui) means unlimited customization but we maintain upgrades.
- Theme-by-CSS-variables keeps theming cheap and runtime-switchable, satisfying multi-theme +
  brandability without per-tenant builds.
- The nav and feature surface are **data-driven** by per-tenant entitlements (ADR-009), so the same
  build serves every company with a different feature set.
