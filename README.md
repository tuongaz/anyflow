# AnyDemo

> Playable, file-defined architecture diagrams. A React Flow canvas wired to a real HTTP server via REST + SSE + Zod schema.

AnyDemo turns a small `demo.json` into a clickable, animating architecture
diagram. Click a `playNode` and the studio fires the configured HTTP request
against your running app; downstream `stateNode`s animate from `running` →
`done` as your app emits events back through the SDK. One flat diagram per
question — never nested, ≤30 nodes — explaining a slice of the architecture
well enough to onboard a new teammate or align a product team.

## Why

Architecture diagrams rot the moment they are drawn. A whiteboard photo can't
tell you whether the `order.created` event still flows from the API to the
inventory worker — only running code can. AnyDemo makes diagrams **executable
artifacts**: the boxes are real endpoints, the arrows fire real requests, and
schema drift is impossible because the studio enforces a single Zod schema.

## Features

- **Playable nodes** — `playNode` with an HTTP `playAction` fires real
  requests against your dev server when the user clicks them.
- **Live state** — `stateNode` with `stateSource: { kind: 'event' }`
  auto-updates from `emit()` calls posted to the studio over SSE.
- **Static context** — `shapeNode` and sourceless `stateNode` for fixed
  context (User browser, Postgres, External S3) that doesn't fire.
- **Single source of truth** — every demo is validated by `DemoSchema` (Zod)
  on disk, on register, and in the runtime watcher.
- **Hot reload** — the studio watches `<repo>/.anydemo/demo.json` and
  broadcasts `demo:reload` to the canvas on every change.
- **Zero config** — `anydemo register --path <repo>` registers a demo and
  drops you straight onto its canvas.
- **Diagram-from-code skill** — a Claude Code plugin
  (`plugins/anydemo-diagram/`) that walks any codebase and generates a
  playable diagram with three checkpoints (scope → tier → node list). See
  [the plugin README](./plugins/anydemo-diagram/README.md).

## Quick start

### Use it (no clone needed)

The studio + CLI ship as the [`anydemo`](https://www.npmjs.com/package/anydemo)
package on npm:

```bash
# Start the studio (downloads anydemo on first run)
npx anydemo start

# In your project repo, register a .anydemo/demo.json:
cd path/to/your/repo
npx anydemo register --path .
```

The CLI prints a URL like `http://localhost:4321/d/<slug>` — open it and play.

> **Note:** the CLI runs on Bun. If you don't have [Bun](https://bun.sh)
> installed, the launcher will bootstrap it via `npx bun` on first use
> (slower one-time startup). For instant startup, install Bun once:
> `curl -fsSL https://bun.sh/install | bash`.

You can also use `bunx anydemo …` if you already have Bun installed.

### Develop on AnyDemo itself

```bash
git clone https://github.com/tuongaz/anydemo.git
cd anydemo
bun install
make dev         # Vite (5173) + Hono studio (4321) in parallel
```

Open `http://localhost:5173` in your browser. Then register an example:

```bash
# In another terminal:
make example-order-pipeline   # runs the demo target on port 3040
make register DIR=examples/order-pipeline
```

## Authoring a demo

A demo is a single JSON file at `<your-repo>/.anydemo/demo.json`:

```json
{
  "version": 1,
  "name": "Order Pipeline",
  "nodes": [
    {
      "id": "create-order",
      "type": "playNode",
      "position": { "x": -480, "y": -384 },
      "data": {
        "label": "POST /orders",
        "kind": "service",
        "stateSource": { "kind": "request" },
        "playAction": {
          "kind": "http",
          "method": "POST",
          "url": "http://localhost:3040/orders",
          "body": { "customerId": "cust-1", "items": [] }
        },
        "detail": { "summary": "Creates an order and fans out to workers." }
      }
    },
    {
      "id": "shipping-worker",
      "type": "stateNode",
      "position": { "x": 360, "y": -1080 },
      "data": {
        "label": "shipping-worker",
        "kind": "worker",
        "stateSource": { "kind": "event" }
      }
    }
  ],
  "connectors": [
    {
      "id": "c-orders-shipping",
      "source": "create-order",
      "target": "shipping-worker",
      "kind": "queue",
      "queueName": "shipments"
    }
  ]
}
```

Register it:

```bash
npx anydemo register --path <your-repo>
```

The CLI validates against `DemoSchema`, registers with the studio, and (if
any node uses `stateSource: { kind: 'event' }`) writes
`<your-repo>/.anydemo/sdk/emit.ts` so your app can drive state:

```ts
import { emit } from './.anydemo/sdk/emit';

await emit('order-pipeline', 'shipping-worker', 'running');
// ...do work...
await emit('order-pipeline', 'shipping-worker', 'done');
```

## Node types

| Type | Purpose | Behavior |
|---|---|---|
| `playNode` | User-triggered HTTP | Click fires `playAction.url` against your app |
| `stateNode` (event) | Auto-updating worker | Animates from `emit()` calls posted to the studio |
| `stateNode` (request) | Passive context | Renders, participates in connectors, no behavior |
| `shapeNode` | Decorative annotation | Rectangle / ellipse / sticky / text — no semantics |

Connectors carry semantics (`http` / `event` / `queue` / `default`) and are
the sole source of truth for inter-node connections.

## Generate a diagram from any codebase

The `anydemo-diagram` plugin (Claude Code) walks a target repo and produces a
playable diagram. Three playability tiers:

1. **Real** — `playAction`s point at your running dev server
2. **Mock harness** — scaffolds `.anydemo/harness/` (Hono on Bun) stubbing
   the boundary routes; play even when the real app isn't trivially runnable
3. **Static** — rich `detail.summary` / `detail.fields` only; no live
   behavior, but the diagram still teaches

```
/diagram show me how the order pipeline works
/diagram --tier=mock how does the auth flow work?
```

See [`plugins/anydemo-diagram/`](./plugins/anydemo-diagram/) for details.

## Project structure

```
anydemo/
├── apps/
│   ├── studio/        # Bun + Hono backend + CLI (publishes as `anydemo`)
│   └── web/           # Vite + React + React Flow SPA
├── packages/
│   └── sdk/           # @anydemo/sdk — emit() helper
├── examples/          # Canonical demo targets
│   ├── order-pipeline/
│   ├── checkout-demo/
│   └── todo-demo-target/
├── plugins/
│   └── anydemo-diagram/   # Claude Code plugin: code → diagram
└── docs/                  # Design docs (gitignored)
```

## Development

```bash
make install     # bun install
make dev         # Vite (5173) + Hono studio (4321) in parallel
make typecheck   # tsc --noEmit across all workspaces
make lint        # biome check
make format      # biome format --write (run before lint)
make test        # bun test
make help        # list every target
```

### Toolchain

- **Runtime**: Bun (≥ 1.3). All scripts run under `bun`, never `node`.
- **Backend HTTP**: Hono via `hono/bun` adapter.
- **Schema**: Zod, single source at `apps/studio/src/schema.ts`.
- **Lint/format**: Biome at the repo root (`biome.json`).
- **TypeScript**: workspaces extend `tsconfig.base.json`; `noEmit` everywhere.

### CLI

```bash
npx anydemo start [--port 4321] [--daemon]   # start the studio
npx anydemo stop                              # stop the daemon
npx anydemo register --path <repo>            # register a demo
```

When developing on AnyDemo itself, the local `bun run apps/studio/src/cli.ts`
is faster (no npm dispatch).

`make register DIR=<path>` is a thin wrapper. Use `DIR=` (not `PATH=` —
that would clobber the shell `$PATH`).

## Status

AnyDemo is **early-stage**. The schema is stable enough to author demos
against, but expect changes. Issues, ideas, and pull requests welcome.

## Contributing

1. Fork and clone.
2. `bun install`.
3. Make changes; keep diffs focused.
4. `make format && make lint && make typecheck && make test` before
   committing.
5. Open a PR.

## License

Not yet licensed for external distribution. Treat the source as
"all rights reserved" until a `LICENSE` file lands. Reach out if you want
to use it.
