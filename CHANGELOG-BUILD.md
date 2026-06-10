# Build Changelog

One line per chunk: what changed, and what the gate proved. Newest at the top.

| Chunk | Tag | What changed | What the gate proved |
|---|---|---|---|
| 1.1 Skeletons | `ckpt/1.1-skeleton-stable` | Compiling skeletons for all four apps + shared contracts: `apps/api` (NestJS, `GET /health` → `{data:{status:'ok'}}`), `apps/worker` (NestJS, `GET /worker/health`), `apps/web` (Next.js 14 dashboard shell), `apps/ml` (FastAPI `/health`); `packages/shared` (success/problem+json/Money/pagination/base-event contracts), `packages/config` (zod env schema consumed by api+worker). Base tsconfig → CommonJS/node. | `pnpm -w build` (all 6 projects compile, incl. Next prod build + type validation), `pnpm -w typecheck`, `pnpm -w lint` all exit 0; api boots and `/health` returns the required envelope. |
| 0.1 Genesis | `ckpt/0.1-genesis-stable` | pnpm monorepo scaffold: workspace layout, root TS/ESLint/Prettier/Vitest tooling, `CLAUDE.md` constitution, ADR-001..007, `.claude` hooks (secret-scan + typecheck) and subagents (explorer/reviewer/test-writer), `.env.example`. No business code. | `pnpm -w typecheck`/`lint`/`test` pass on the empty workspace; `CLAUDE.md` present; exactly 7 ADRs in `docs/adr`; `.claude/settings.json` hooks present. |
