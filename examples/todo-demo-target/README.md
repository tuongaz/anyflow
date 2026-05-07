# todo-demo-target — canonical AnyDemo M1 verification target

A tiny Bun + Hono app paired with a hand-authored `.anydemo/demo.json` that
exercises **every** Milestone-1 feature in one place. Use it as the run-book
for the 9 verification steps below.

## Layout

```
todo-demo-target/
├── package.json               # Bun + Hono dep, `bun run start` entrypoint
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts               # Boots app on :3030 + starts the event-bus worker
│   ├── server.ts              # Hono app: POST /todos, GET /todos, POST /todos/:id/complete, GET /admin/stats
│   ├── store.ts               # In-memory todo store (with seed-1 pre-loaded)
│   ├── event-bus.ts           # Tiny pub/sub
│   └── worker.ts              # Subscribes to todo.completed → emits running → done
└── .anydemo/
    └── demo.json              # 3 nodes: create-todo, complete-todo, todo-worker (event)
```

## Routes

| Method | Path                       | Notes                                                        |
| ------ | -------------------------- | ------------------------------------------------------------ |
| POST   | `/todos`                   | Create a todo from `{ title }`. Returns the new todo (201).  |
| GET    | `/todos`                   | List all todos (sorted by `createdAt`).                      |
| POST   | `/todos/:id/complete`      | Mark complete + publish `todo.completed`. 404 if id unknown. |
| GET    | `/admin/stats`             | `{ total, completed, pending, lastCompletedId }` — used as the `dynamicSource` for the create-todo node. |
| GET    | `/health`                  | `{ ok: true }`.                                              |

The store ships pre-seeded with one todo (`id: seed-1`, title: `Try AnyDemo`)
so the demo's `complete-todo` Play node can fire on the first click without
state setup.

## Demo nodes

- **`api-create-todo`** (playNode): `POST /todos` with body `{ title: "Buy milk" }`.
  Has `data.detail.dynamicSource = GET /admin/stats` — clicking the node opens
  a panel that fetches stats live.
- **`api-complete-todo`** (playNode): `POST /todos/seed-1/complete`. Marks the
  seed todo complete, which triggers the worker.
- **`todo-worker`** (stateNode, `stateSource.kind = 'event'`): driven entirely
  by `node:running` / `node:done` events the worker emits via `/api/emit`.

## V1–V9 run-book

> All commands are run from the **repo root** unless noted otherwise.
> Studio defaults: `http://localhost:4321` (UI + API). Demo target: `:3030`.

### Setup (one-time)

```bash
bun install
```

### V1 — `npx anydemo start` boots studio; empty-state at `localhost:4321`

```bash
bun run apps/studio/src/cli.ts start --daemon
open http://localhost:4321
```

Expected: empty grid + "Press ⌘K to open the project switcher" hint, OR the
copy-able `npx anydemo register --path .` empty-state if the registry is empty
on this machine. Stop with `bun run apps/studio/src/cli.ts stop`.

### V2 — `register --path <folder>` makes the demo appear in the switcher

```bash
bun run apps/studio/src/cli.ts register --path examples/todo-demo-target
```

Expected output:

```
Registered "Todo Demo" → http://localhost:4321/d/todo-demo
Wrote /…/examples/todo-demo-target/.anydemo/sdk/emit.ts (event-bound state node detected)
```

Open `http://localhost:4321`. Press `⌘K`. Pick **Todo Demo**. The canvas
shows three nodes with one edge `complete-todo → todo-worker`.

### V3 — re-running `register` is idempotent

```bash
bun run apps/studio/src/cli.ts register --path examples/todo-demo-target
```

Expected: same slug printed (`/d/todo-demo`); the second line reads
`SDK helper already present at … (skipped)`. The switcher still shows a
single **Todo Demo** entry — no duplicates.

### V4 — `register` auto-starts the studio if it isn't running

```bash
bun run apps/studio/src/cli.ts stop
bun run apps/studio/src/cli.ts register --path examples/todo-demo-target
```

Expected: the CLI prints `Studio not running at …; starting in background…`,
then `Studio started (pid …)`, then the usual `Registered …` line. To prove
the opt-out works, kill again and run with `--no-start` — it should error
clearly: `Start it first: anydemo start`.

### V5 — editing `demo.json` live-reloads the canvas (no refresh)

With studio running and the **Todo Demo** canvas open:

1. In another terminal, edit `examples/todo-demo-target/.anydemo/demo.json` —
   change `"label": "POST /todos"` to `"label": "POST /todos (live)"` and save.
   The label updates on the canvas within ~100ms; no browser refresh needed.
2. Introduce a syntax error (e.g. delete a closing `}`). The canvas keeps the
   last-good nodes but a red banner appears with the parse error and the
   header reload-indicator turns red. Fix the file → banner clears.

### V6 — Play action fires real HTTP, node animates running → done

Start the demo target in another terminal:

```bash
bun run --filter @anydemo/example-todo-demo-target start
```

(Or: `cd examples/todo-demo-target && bun run start`.)

Click Play on **api-create-todo**. Expected:
- Node pulses with the `running` style; the edge to any downstream node
  animates.
- Within ~200ms the pill flips to `done`.
- The right-hand detail panel renders the response body in the JSON tree
  view (`{ id: "todo-2", title: "Buy milk", … }`).

Targeting an unreachable host — point the `playAction.url` at
`http://does-not-exist.anydemo-test.invalid` and re-fire — flips the pill to
`error` with the network-failure message in the panel; studio stays alive.

### V7 — dynamic detail panel

Click the **api-create-todo** node (don't Play). Expected:
- Static fields (`Service: todo-demo-target`, `Port: 3030`) render instantly.
- Below them, a **Live detail** section shows a brief skeleton, then the JSON
  tree of `GET /admin/stats` — `{ total: N, completed, pending, lastCompletedId }`.
- The refresh button (↻) re-fires the fetch.
- Closing and re-opening the panel re-fetches (no cross-open caching).

### V8 — `POST /api/emit` lights up an event-bound node

The worker calls `/api/emit` itself when you complete a todo, but you can also
fire it manually:

```bash
# 1. Look up the demoId for the slug `todo-demo`:
DEMO_ID=$(curl -s http://localhost:4321/api/demos | \
  bun -e 'const list = await Bun.stdin.json(); console.log(list.find(d => d.slug === "todo-demo").id);')

# 2. Fire running → done:
curl -s -X POST http://localhost:4321/api/emit \
  -H 'content-type: application/json' \
  -d "{\"demoId\":\"$DEMO_ID\",\"nodeId\":\"todo-worker\",\"status\":\"running\"}" >/dev/null
sleep 0.5
curl -s -X POST http://localhost:4321/api/emit \
  -H 'content-type: application/json' \
  -d "{\"demoId\":\"$DEMO_ID\",\"nodeId\":\"todo-worker\",\"status\":\"done\"}" >/dev/null
```

Expected: the **todo-worker** state-node pill flips `running` then `done`.
Click the worker node → the **Recent events** section in the detail panel
lists the last 5 events newest-first with `HH:MM:SS` timestamps.

End-to-end variant (uses the auto-written SDK on the worker side): with the
todo-demo-target running, click Play on **api-complete-todo** in the canvas.
The worker's bus subscriber fires `emit('…', 'todo-worker', 'running')` →
`done`, and the state-node lights up the same way.

### V9 — restart rehydrates the registry

```bash
bun run apps/studio/src/cli.ts stop
# (wait a moment for the pid file to clear)
bun run apps/studio/src/cli.ts start --daemon
open http://localhost:4321
```

Expected: pressing ⌘K still shows **Todo Demo**, the canvas at `/d/todo-demo`
still renders the same three nodes, and the per-node `valid:true` flag
matches the on-disk demo file.

## Cleanup

```bash
# Stop both processes
bun run apps/studio/src/cli.ts stop
# (kill the demo target's terminal manually with ^C)

# Forget the demo (does NOT delete the .anydemo/demo.json on disk):
DEMO_ID=$(curl -s http://localhost:4321/api/demos | \
  bun -e 'const list = await Bun.stdin.json(); console.log(list.find(d => d.slug === "todo-demo")?.id ?? "");')
[ -n "$DEMO_ID" ] && curl -s -X DELETE "http://localhost:4321/api/demos/$DEMO_ID"
```
