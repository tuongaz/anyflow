# AnyDemo

Local studio that hosts file-defined demos as React Flow canvases wired to a running app via REST + SSE + Zod schema.

## What this is, in one paragraph

AnyDemo is the runtime for **playable, single-flat architecture diagrams** —
diagrams an AI agent can generate from any codebase, that real engineers, QAs,
BAs, and POs can *click on and watch run*. The studio hosts a `demo.json`
authored by the user (or by the upcoming agent skill) and renders it as a
React Flow canvas wired to a target app via REST + SSE + Zod schema. Nodes are
either **static** (`shapeNode`, or `stateNode` with no `playAction` — fixed
context like "User browser" or "Postgres") or **dynamic** (`playNode` for
user-triggered HTTP, or `stateNode` with `stateSource: { kind: 'event' }` that
auto-updates from the SDK's `emit()`). The goal is one flat diagram per
question — never nested, ≤30 nodes — that explains a slice of the architecture
well enough to onboard a new teammate or align a product team.

## Diagram-generator skill (in design)

A Claude Code plugin lives alongside the studio at `plugins/anydemo-diagram/`
(see `docs/plans/2026-05-09-playable-diagram-skill-design.md`). Given a
target codebase and a free-text question ("show me the order pipeline"), the
skill walks the code, consults the user at three checkpoints (scope → tier →
node list), and emits a `.anydemo/demo.json` plus optionally a tiny mock
harness. Three playability tiers are surfaced to the user:

1. **Real** — `playAction`s point at the user's running dev server; events
   flow through the existing SDK.
2. **Mock harness** — skill scaffolds `.anydemo/harness/` (Hono on Bun)
   stubbing the boundary routes so the diagram plays even when the real app
   isn't trivially runnable.
3. **Static** — no `playAction`s; rich `detail.summary` / `detail.fields` /
   `detail.filePath` so the diagram still teaches.

The plugin reuses the studio's Zod `DemoSchema` directly (one source of
truth) and registers via the existing `anydemo register` CLI. Patterns
borrowed from Understand-Anything: deterministic scripts before LLM phases,
intermediate JSON files between phases, rigid output contracts with
self-checks, and explicit anti-pattern enumeration in subagent prompts.

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

A `Makefile` at the repo root wraps these (and the CLI subcommands) for discoverability — run `make help` to see the target list. It's sugar over the bun commands above, not a replacement; both stay in sync. `make register` takes `DIR=<path>` (not `PATH=` — that would clobber the shell `PATH` env var when Make exports command-line overrides to subshells). `make ralph` runs the autonomous agent loop in `ralph/ralph.sh` with a default of 10 iterations; override with `ITERATIONS=<n>`.
