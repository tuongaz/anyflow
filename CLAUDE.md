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

## Dev / prod split

- Dev: `bun run dev` runs Vite on `5173` and Hono on `4321` in parallel via `bun run --filter '*' dev`. Hono catch-all proxies non-`/api/*` requests to Vite. Vite HMR pins host/port to `5173` so the HMR WebSocket bypasses Hono — do NOT try to proxy the WebSocket through Hono.
- Prod: `cd apps/web && bun run build` emits to `apps/studio/dist/web/`. `NODE_ENV=production` makes `apps/studio/src/server.ts` serve that bundle via `serveStatic`; end users never run Vite.
- Web app uses `@/*` alias for `apps/web/src/*` — declared in both `apps/web/tsconfig.json` and `apps/web/vite.config.ts`. Update both when changing it.
- shadcn/ui primitives live at `apps/web/src/components/ui/`; `cn(...)` helper at `apps/web/src/lib/utils.ts`.
- Frontend routing is hand-rolled at `apps/web/src/lib/router.ts` (`usePathname()` + `navigate(to)`); a custom `anydemo:navigate` event re-renders all `usePathname()` consumers when `pushState` happens. Do not pull in `react-router-dom`.
- Biome's `organizeImports` sorts imports alphabetically by source string — `@/foo` imports come BEFORE third-party imports (`lucide-react`, `react`) because `@` < `l` < `r` in ASCII. Run `bun run format` then check lint output.

## Conventions

- Workspace package names are scoped `@anydemo/*`.
- The CLI (`apps/studio/src/cli.ts`) is a hand-rolled arg parser — do not pull in commander/yargs.
- Studio listens on `localhost:4321` by default. Registry persists at `~/.anydemo/registry.json`. PID at `~/.anydemo/anydemo.pid`.
- SSE event framing: `event: <type>\ndata: <json>\n\n`.
- The only place the CLI mutates user repos is `.anydemo/sdk/emit.ts` writes during `register` — and only when the demo declares an event-bound state node.
