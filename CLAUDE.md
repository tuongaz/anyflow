# AnyDemo

Local studio that hosts file-defined demos as React Flow canvases wired to a running app via REST + SSE + Zod schema.

## Workspace

- `apps/studio/` — Bun + Hono backend + CLI (`anydemo`)
- `apps/web/` — Vite + React + React Flow SPA
- `packages/sdk/` — `emit()` helper
- `plugins/anydemo-diagram/` — Claude Code plugin that generates demos
- `examples/` — demo targets

## Toolchain

- **Bun** (`>= 1.3`) — never node.
- **Hono** via `hono/bun` — never `@hono/node-server`.
- **Zod** schema at `apps/studio/src/schema.ts` (single source of truth).
- **Biome** for lint/format. Run `bun run format` before `bun run lint`.

## Commands

```bash
bun run dev         # Vite (5173) + Hono studio (4321)
bun run typecheck
bun run lint
bun test
```

`make help` lists Makefile wrappers.
