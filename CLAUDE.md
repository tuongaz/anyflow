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
```

## Conventions

- Workspace package names are scoped `@anydemo/*`.
- The CLI (`apps/studio/src/cli.ts`) is a hand-rolled arg parser — do not pull in commander/yargs.
- Studio listens on `localhost:4321` by default. Registry persists at `~/.anydemo/registry.json`. PID at `~/.anydemo/anydemo.pid`.
- SSE event framing: `event: <type>\ndata: <json>\n\n`.
- The only place the CLI mutates user repos is `.anydemo/sdk/emit.ts` writes during `register` — and only when the demo declares an event-bound state node.
