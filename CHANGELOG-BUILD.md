# Build Changelog

One line per chunk: what changed, and what the gate proved. Newest at the top.

| Chunk | Tag | What changed | What the gate proved |
|---|---|---|---|
| 0.1 Genesis | `ckpt/0.1-genesis-stable` | pnpm monorepo scaffold: workspace layout, root TS/ESLint/Prettier/Vitest tooling, `CLAUDE.md` constitution, ADR-001..007, `.claude` hooks (secret-scan + typecheck) and subagents (explorer/reviewer/test-writer), `.env.example`. No business code. | `pnpm -w typecheck`/`lint`/`test` pass on the empty workspace; `CLAUDE.md` present; exactly 7 ADRs in `docs/adr`; `.claude/settings.json` hooks present. |
