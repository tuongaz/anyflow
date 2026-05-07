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
- Studio listens on `localhost:4321` by default. Registry persists at `~/.anydemo/registry.json`. PID at `~/.anydemo/anydemo.pid`. Studio address persists at `~/.anydemo/config.json` (`{ port, host }`) — `start` writes it; non-`start` subcommands read it.
- SSE event framing: `event: <type>\ndata: <json>\n\n`.
- Studio runtime helpers live at `apps/studio/src/runtime.ts` (`readConfig/writeConfig/readPid/writePid/clearPid/isPidAlive/studioUrl`). Use these — don't reach into `~/.anydemo/*` directly from cli.ts or server.ts.
- `start --daemon` self-spawns via `Bun.spawn({ cmd: [process.execPath, import.meta.path, 'start', '--port=N'], stdio: ['ignore','ignore','ignore'] })` + `proc.unref()`, then polls `/health` (10s). The detached child re-enters `start` (non-daemon) and writes its own pid; pid+config files are the only handoff between parent and child.
- The only place the CLI mutates user repos is `.anydemo/sdk/emit.ts` writes during `register` — and only when the demo declares an event-bound state node.
- Registry entries store `demoPath` as given (typically relative `.anydemo/demo.json`). Resolve at use-time via `isAbsolute(demoPath) ? demoPath : join(repoPath, demoPath)`. `GET /api/demos` AND-combines the persisted `valid` flag with `existsSync(fullPath)` so missing-on-disk demos surface as `valid:false` without dropping the registry entry.
- `apps/studio/src/events.ts` is an in-memory pub/sub keyed by demoId (`createEventBus()` → `subscribe/broadcast/subscriberCount`); a throwing subscriber is logged + dropped without blocking siblings. `apps/studio/src/watcher.ts` runs one `fs.watch(dir)` per demo (filters by `basename(filePath)` so editor rename-on-save patterns still fire) with ~100ms debounce; reparse always preserves the previous valid `demo` on failure so `GET /api/demos/:id` can serve last-good. `createApp` constructs an EventBus + DemoWatcher by default and wires them into the api; tests should pass `disableWatcher: true` to avoid leaking fs.watch handles (calls to `POST /demos/register` would otherwise start a watch on every test repo).
- SSE endpoint `GET /api/events?demoId=:id` uses Hono's `streamSSE` from `hono/streaming`. Always send an initial `event: hello` on connect — the frontend `useStudioEvents` re-fetches on every `hello` (i.e. on initial connect AND every reconnect) so the page catches up after dropped streams. Event framing is `event: <type>\ndata: <json>\n\n`.
- React Flow custom nodes live in `apps/web/src/components/nodes/` (`play-node.tsx`, `state-node.tsx`, `status-pill.tsx`). The xyflow `NodeProps<MyNode>` generic requires `MyNode extends Node<Record<string, unknown>>`, so node data types must intersect with `Record<string, unknown>`. Pass `nodeTypes` as a stable object reference (declared at module scope) and pass `selected` via the `selectedNodeId` prop — React Flow's internal selection state is bypassed in favor of the parent-managed `selectedId` so click events on the canvas pane can clear the selection.
- Per-node run state is owned by `apps/web/src/hooks/use-node-runs.ts` (`useNodeRuns(demoId)` → `{ runs, apply, reset }`); `App.tsx` lifts this and feeds events from `useStudioEvents.onEvent` into `apply(event)`. The reducer keys off `nodeId` and ignores non-`node:*` event types, so it's safe to wire to the same SSE handler that drives `demo:reload`. Pass `runs` down to `<DemoCanvas>` so React Flow node `data.status` and edge `animated` flags can be derived per render.
- Play proxy lives at `apps/studio/src/proxy.ts` (`runPlay({events, demoId, nodeId, action})`) and is mounted at `POST /api/demos/:id/play/:nodeId` in `api.ts`. The handler always re-reads + re-validates the demo file from disk on each play (so the user's most recent edit drives the actual fetch — even if the watcher hasn't broadcast yet). Broadcasts `node:running` BEFORE fetch and `node:done`/`node:error` after; the synchronous response carries `{runId, status, body}` (or `{runId, error}`) so callers can correlate the run across SSE + the originating fetch.
