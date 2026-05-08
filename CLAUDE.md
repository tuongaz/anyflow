# AnyDemo

Local studio that hosts file-defined demos as React Flow canvases wired to a running app via REST + SSE + Zod schema.

## Workspace layout

- `apps/studio/` — Bun + Hono backend + CLI (publishes as `anydemo`)
- `apps/web/` — Vite + React + React Flow SPA, built into `apps/studio/dist/web/`
- `packages/sdk/` — `emit()` helper, copied into user repos by `register`
- `examples/` — canonical demo target(s) for verification

## Toolchain

- **Runtime:** Bun (`>= 1.3`). All scripts run under `bun`, never node.
- **Backend HTTP:** Hono via `hono/bun` adapter — never `@hono/node-server`.
- **Schema validation:** Zod, single source at `apps/studio/src/schema.ts`.
- **Lint/format:** Biome at the repo root (`biome.json`). Run `bun run format` before lint.
- **TypeScript:** workspaces extend `tsconfig.base.json`. `noEmit: true` + `tsc --noEmit` for typecheck.

## Common commands

```bash
bun install            # install all workspace deps
bun run typecheck      # tsc --noEmit across all workspaces
bun run lint           # biome check
bun run format         # biome format --write
bun test               # bun test (workspace-scoped tests)
bun run dev            # parallel: Vite (5173) + Hono studio (4321)
```

A `Makefile` at the repo root wraps these (and the CLI subcommands) for discoverability — run `make help` to see the target list. It's sugar over the bun commands above, not a replacement; both stay in sync. `make register` takes `DIR=<path>` (not `PATH=` — that would clobber the shell `PATH` env var when Make exports command-line overrides to subshells).
