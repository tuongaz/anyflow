---
name: create-anydemo
description: Use when the user asks to create, generate, or scaffold an AnyDemo flow from a natural-language prompt (triggers like "create a demo", "show how X works", "make me a flow of Y", "diagram our checkout system"). Orchestrates four sub-agents and bun scripts to write a registered, validated demo under <project>/.anydemo/<slug>/.
---

# create-anydemo

Turn a natural-language prompt ("show how checkout works") into a registered,
runnable, validated AnyDemo flow under `<project>/.anydemo/<slug>/`. You — the
main thread — orchestrate four sub-agents and a handful of bun scripts; you
never read the user's codebase directly.

## When to invoke

You are invoked by description. Trigger phrases include:

- "create a demo of X" / "make me a flow of Y" / "diagram our X system"
- "show how X works" / "visualise X" / "scaffold a demo for X"
- "add another demo to this repo" (edit / multi-demo case)

Stop and ask for clarification only when the prompt is incoherent — never ask
"what is your codebase?". The discoverer's job is to figure that out.

## Inputs you have

- The user's full natural-language prompt.
- The project root (`$PWD` at invocation — the directory the user is in).
- `~/.anydemo/config.json` (optional; supplies studio host:port, default
  `http://localhost:4321`).
- Existing `<project>/.anydemo/<slug>/demo.json` files, if any (multi-demo
  per project is supported; check before creating).

## The pipeline

```
Phase 0 — pre-flight: studio reachable?
Phase 1 — anydemo-discoverer        → context brief (language + runtime + tests)
Phase 2 — anydemo-node-planner      → node draft
Phase 3 — anydemo-play-designer  ┐
          anydemo-status-designer├ parallel → overlays
                                 ┘
Phase 4 — synthesize → validate-schema (no user confirmation)
Phase 5 — write files → register.ts
Phase 6 — validate-end-to-end.ts → trigger APIs → verify via SSE (retry up to 2x)
Phase 7 — open browser on success / retry-or-stop on failure
```

Each phase is **gated** on the previous one. Do not start Phase N+1 until
Phase N has succeeded.

---

## Phase 0 — pre-flight (studio reachable)

Resolve the studio URL: prefer `ANYDEMO_STUDIO_URL` env var, else
`~/.anydemo/config.json`'s `port` field, else default `http://localhost:4321`.
Then:

```bash
curl --max-time 0.5 -fsS "$STUDIO_URL/health"
```

On any failure (connection refused, timeout, non-2xx):

1. Check whether the `anydemo` CLI is installed:

```bash
which anydemo
```

2. Print the appropriate message and STOP:

   **CLI found** (`which anydemo` exits 0):
   ```
   Studio not reachable at <url>. Start it with:

     anydemo start
   ```

   **CLI not found** (`which anydemo` exits non-zero):
   ```
   Studio not reachable at <url> and the anydemo CLI is not installed.

   To get started, either:

     npx anydemo start          # run without installing

   or check out the repo and run:

     make dev                   # starts studio at http://localhost:4321
   ```

Do not retry. Do not auto-start. The user must launch the studio themselves.

On success: continue to Phase 1.

---

## After Phase 0 — list tasks

Before launching any sub-agent, create a TodoWrite checklist so the user can
track progress in real time. Create one todo per phase using `TaskCreate`:

```
[ ] Phase 1 — Discover codebase (language, runtime, integration tests)
[ ] Phase 2 — Plan nodes & connectors
[ ] Phase 3 — Design Play + Status scripts (parallel)
[ ] Phase 4 — Synthesize & validate schema
[ ] Phase 5 — Write files & register demo
[ ] Phase 6 — End-to-end validation (trigger APIs, verify via SSE)
[ ] Phase 7 — Open browser
```

Mark each todo complete (via `TaskUpdate`) immediately after the phase
succeeds — before starting the next one. This gives the user a live view of
where the pipeline is.

---

## Phase 1 — discover

Launch the `anydemo-discoverer` sub-agent with the user's prompt, the project
root, and (if you found any) the existing `demo.json` for the matching slug.
The sub-agent has read-only tools (`Read`, `Grep`, `Glob`, `LS`, `Bash` for
read-only commands).

The discoverer MUST:
- Identify the primary language and runtime (`runtimeProfile`)
- Find integration / blackbox / e2e tests and extract the setup pattern they
  use (ports, base URLs, payload shapes) — this is how play scripts are
  grounded in reality rather than guessing
- Surface `runtimeProfile.setupPattern` with the exact pattern

Expected output (the sub-agent's final message must be parseable JSON):

```json
{
  "userIntent": "…",
  "audienceFraming": "…",
  "scope": { "rootEntities": ["…"], "outOfScope": ["…"] },
  "codePointers": [{ "path": "…", "why": "…" }],
  "runtimeProfile": {
    "primaryLanguage": "typescript",
    "packageManager": "bun",
    "devCommand": "bun run dev",
    "testCommand": "bun test",
    "servicePort": 3001,
    "integrationTestDir": "tests/integration",
    "integrationTestCommand": "bun test tests/integration",
    "setupPattern": "Tests call http://localhost:3001 with JSON payloads after starting the server"
  },
  "existingDemo": null
}
```

If the brief is unparseable or missing required fields: retry the sub-agent
ONCE with the validation issue surfaced. If the retry also fails, surface the
problem to the user and stop.

---

## Phase 2 — plan nodes

Launch `anydemo-node-planner` with the context brief. The planner has **no
tools** — it reasons purely from the brief. It applies two mandatory passes:

- **Resource nodes first** — every DB, queue, event bus, cache, file store,
  and external SaaS touched by the flow gets its own `stateNode`, whether
  named in `rootEntities` or inferred from service behavior.
- **Abstraction rules second** — one node per service / workflow / worker /
  queue / DB (exceptions: independently-meaningful pipeline stages, fan-out
  consumers, branches).

Expected output:

```json
{
  "name": "…",
  "slug": "…",
  "nodes": [{ "id": "…", "type": "…", "data": {…}, "oneNodeRationale": "…" }],
  "connectors": [{ "id": "…", "kind": "…", "source": "…", "target": "…" }]
}
```

Same retry budget: one retry on unparseable output, then surface and stop.

---

## Phase 3 — design Play + status (parallel)

Launch `anydemo-play-designer` and `anydemo-status-designer` **in parallel**
(send a single message with two `Task` tool calls; do not serialise them).
Both receive the same input: the context brief + the node draft + the edit
target (if any). Both have read-only file tools (`Read`, `Grep`, `Glob`,
`LS`).

`anydemo-play-designer` returns:

```json
{
  "playOverlays": [{
    "nodeId": "…",
    "playAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                    "scriptPath": "<slug>/scripts/<name>.ts",
                    "input": {…}, "timeoutMs": 15000 },
    "scriptBody": "<full bun/python/node source as a string>",
    "validationSafe": true,
    "rationale": "…"
  }],
  "newTriggerNodes": []
}
```

`anydemo-status-designer` returns:

```json
{
  "statusOverlays": [{
    "nodeId": "…",
    "statusAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                      "scriptPath": "<slug>/scripts/<name>.ts",
                      "maxLifetimeMs": 600000 },
    "scriptBody": "<full source>",
    "rationale": "…"
  }]
}
```

`newTriggerNodes` (play-designer only) may inject synthetic source nodes
(file-drop, webhook receiver, fixture producer) when no natural trigger
exists in the draft.

---

## Phase 4 — synthesize + validate schema

In the main thread:

1. **Splice** `newTriggerNodes` into `nodeDraft.nodes` (and add any
   connectors the play-designer required).
2. **Merge** each `playOverlay` and `statusOverlay` onto its target node's
   `data` field. Strip `validationSafe` + `rationale` + `scriptBody` from
   the merged `playAction` / `statusAction` — they are orchestrator-side
   metadata that the schema does NOT accept. Keep `validationSafe` in a
   sidecar map (`{ nodeId → boolean }`) for Phase 6.
3. **Write** the merged `Demo` to a temporary path
   (e.g. `/tmp/anydemo-<slug>-draft.json`).
4. **Validate** locally:

```bash
bun skills/create-anydemo/scripts/validate-schema.ts /tmp/anydemo-<slug>-draft.json
```

Exit 0 with `{"ok":true}` → continue. Exit 1 with `{"ok":false,"issues":[…]}`
→ feed the issues back to the relevant sub-agent (play-designer if a play
field; status-designer if a status field; node-planner otherwise) and retry.
**Max 3 schema retries** before surfacing the raw issue list verbatim to the
user and stopping.

5. Proceed directly to Phase 5 — do not pause to present the plan or ask
   the user for confirmation. Writing and validating quickly gives the user
   something real to react to faster than a plan ever could.

A worked plan example lives at `references/examples/checkout-flow-plan.md`
(informational only — no longer shown to the user).

---

## Phase 5 — write files + register

Proceed immediately after Phase 4 schema validation passes.

1. **Compute paths**: `repoPath = $PWD`,
   `demoDir = $PWD/.anydemo/<slug>`,
   `demoPath = .anydemo/<slug>/demo.json` (relative — that is what
   `register.ts` posts).
2. **Create dirs**: `mkdir -p $demoDir/scripts $demoDir/state`.
3. **Write the files**:
   - `$demoDir/demo.json` — the validated `Demo` object (pretty-printed).
   - `$demoDir/scripts/<playScriptName>` — one file per playOverlay
     `scriptBody`. Mark executable (`chmod +x`).
   - `$demoDir/scripts/<statusScriptName>` — one file per statusOverlay
     `scriptBody`. Mark executable.
   - `$demoDir/state/.gitignore` — `*` (state files are runtime-only).
4. **Register**:

```bash
bun skills/create-anydemo/scripts/register.ts --path "$repoPath" --demo "$demoPath"
```

The script POSTs `{name, repoPath, demoPath}` to `/api/demos/register` and
prints `{id, slug}` to stdout. Stash the `id` for Phase 6 + Phase 7.

If `register.ts` exits non-zero with a 400 body: show the body verbatim, ask
the user whether to fix-and-retry (loop back to Phase 4) or stop. On any
other 4xx/5xx: print the body and stop — the studio is in an unexpected
state.

---

## Phase 6 — end-to-end validation

This phase MUST run. Do not skip it, do not simulate it, do not report
success without running the script and reading its output.

```bash
bun skills/create-anydemo/scripts/validate-end-to-end.ts <id>
```

The script:

- GETs `/api/demos/<id>` (expects 200, `valid: true`).
- Opens an SSE channel at `/api/events?demoId=<id>` **before** triggering
  any play, so events are buffered from the start.
- For each node with a `playAction` where `validationSafe !== false`,
  POSTs `/api/demos/<id>/play/<nodeId>` and awaits the HTTP response
  (the play endpoint is synchronous — it waits for the script to finish).
- After all plays complete, drains the SSE channel to collect
  `node:done` / `node:error` events for play nodes and `node:status`
  events for status nodes. SSE outcome takes precedence over HTTP when
  both are available.
- Hard ceiling of ~2 minutes total.
- Emits a single JSON line: `{ok, plays, statuses, skipped}`.

**Interpret the JSON, do not just print it.** Every `plays[*]` entry with
`outcome: "failed"` represents a play script that errored — this is a
real failure, not a warning. On `ok: true`: continue to Phase 7.
On `ok: false`:

1. Read `plays[*].outcome` + `plays[*].error` and `statuses[*].outcome` to
   identify failing nodes.
2. Propose a concrete fix-up (e.g. "play-checkout.ts failed with
   `ECONNREFUSED` — the app is not listening on port 3001; update the
   script's base URL or ask the user to start the app first").
3. Edit the failing scripts in-place, then re-run Phase 6 against the same
   registered `<id>`. **Max 2 fix-up retries.** After the second failure,
   present the failures verbatim and ask the user `retry / stop`.

The fix-up loop never re-runs `register.ts` — it edits scripts and re-runs
Phase 6 only.

---

## Phase 7 — open the browser

On Phase 6 success:

```bash
url="$STUDIO_URL/d/<slug>"
case "$(uname)" in
  Darwin) open "$url" ;;
  Linux)  xdg-open "$url" ;;
  *)      echo "Open $url" ;;
esac
```

Print a one-line success message: `Demo "<name>" registered as <slug>.
Open: <url>`. You are done — return control to the user.

On Phase 6 failure: never open the browser. Stop on the user's `retry / stop`
decision.

---

## Error-handling table

| Failure | Response |
|---|---|
| Studio `/health` fails (Phase 0) | Check `which anydemo`; if found tell user `anydemo start`; if not found tell user `npx anydemo start` or `make dev`. No retry. |
| Sub-agent returns unparseable output | Retry the sub-agent once with the parse error; if it fails again, surface to user and stop. |
| Schema validation fails (Phase 4) | Loop back to the relevant designer with the Zod issue list. Max 3 retries; then surface issues verbatim. |
| Register 400 (Phase 5) | Show response body; ask user "fix-and-retry / stop". |
| Register 4xx/5xx other (Phase 5) | Show response body; stop. |
| Play returns `{error: "…"}` (Phase 6) | Capture; let LLM interpret + propose fix-up plan; loop to Phase 4 (max 2 retries). |
| Status SSE timeout 10s (Phase 6) | Mark node `no status received`; include in fix-up reasoning or ask user retry/stop. |
| Validation total >2 min (Phase 6) | Script SIGTERMs in-flight checks and exits with `ok:false`; treat as failure → fix-up path. |

Two retry budgets, both hard caps:

- **Phase 4 schema retries** — max **3** before surfacing.
- **Phase 6 fix-up retries** — max **2** before asking the user.

---

## Schema cheatsheet

The full Zod schema lives at `skills/create-anydemo/vendored/schema.ts`. Read
it when you need exact field-level truth. Below is the one-page recap that
covers ~95% of node design.

### `Demo` envelope

```json
{
  "version": 1,
  "name": "Checkout Flow",
  "nodes": [ …NodeSchema… ],
  "connectors": [ …ConnectorSchema… ],
  "resetAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                   "scriptPath": "<slug>/scripts/reset.ts" }
}
```

`resetAction` is optional — include it only if the running app has a
"wipe my state" entrypoint the audience will use.

### Node types

**playNode** — functional node that has a clickable Play button. Required:
`name`, `kind`, `stateSource`, `playAction`. Optional: `statusAction`,
`description`, `detail`, visual overrides.

`description` is shown directly on the node card — keep it **≤ 15 words**.

`kind` drives the semantic label and tells the status-designer what to monitor.
Use: `service`, `endpoint`, `worker`, `workflow`, `queue`, `topic`, `bus`,
`db`, `store`, `cache`, `scheduler`, `external-api`, `trigger`.

```json
{
  "id": "checkout-api", "type": "playNode", "position": { "x": 100, "y": 200 },
  "data": {
    "name": "POST /checkout", "kind": "service",
    "stateSource": { "kind": "request" },
    "playAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                    "scriptPath": "checkout-flow/scripts/play-checkout.ts",
                    "input": { "items": [{"sku":"ABC","qty":1}] },
                    "timeoutMs": 15000 },
    "description": "Receives a cart, creates an order."
  }
}
```

**stateNode** — functional node WITHOUT a mandatory Play (Play and status
are both optional). Used for downstream services / databases / workers the
audience watches but doesn't trigger directly. Use the same `kind` values as
`playNode` — `"db"` for databases, `"queue"` for queues, `"cache"` for
caches, `"store"` for file/object stores, `"bus"` for event buses, etc.

```json
{
  "id": "order-db", "type": "stateNode", "position": { "x": 600, "y": 200 },
  "data": {
    "name": "Orders DB", "kind": "database",
    "stateSource": { "kind": "event" },
    "statusAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                      "scriptPath": "checkout-flow/scripts/status-orders.ts",
                      "maxLifetimeMs": 600000 }
  }
}
```

**shapeNode** — illustrative or geometric node with no actions or live state.
Use for actors and external references the demo doesn't monitor. Pick `shape`
from the table:

| `shape` | Renders as | Best for |
|---|---|---|
| `database` | Cylinder | DB label (decorative; use `stateNode` when monitoring) |
| `server` | Server rack | On-premise server or compute |
| `user` | Person silhouette | Human actor / customer / operator |
| `queue` | Stack | Queue label (decorative) |
| `cloud` | Cloud outline | External SaaS or third-party platform |
| `rectangle` | Box | Grouping boundary |
| `ellipse` | Oval | Generic annotation |
| `sticky` | Sticky note | Callout or explanation |
| `text` | Plain text | In-canvas text label |

```json
{ "id": "customer", "type": "shapeNode", "position": { "x": 0, "y": 200 },
  "data": { "shape": "user", "name": "Customer" } }

{ "id": "stripe", "type": "shapeNode", "position": { "x": 800, "y": 200 },
  "data": { "shape": "cloud", "name": "Stripe", "borderStyle": "dashed" } }

{ "id": "boundary", "type": "shapeNode", "position": { "x": 50, "y": 50 },
  "data": { "shape": "rectangle", "name": "Internal services", "borderStyle": "dashed" } }
```

**iconNode** — single Lucide glyph with optional caption. Decorative only.

```json
{ "id": "user-icon", "type": "iconNode", "position": { "x": 0, "y": 200 },
  "data": { "icon": "User", "name": "Customer", "width": 64, "height": 64 } }
```

**group** — container; children declare it via `parentId`. Drag the group
and the children come along.

```json
{ "id": "internal", "type": "group", "position": { "x": 100, "y": 100 },
  "data": { "name": "Internal services", "width": 800, "height": 400 } }
```

**htmlNode** — escape-hatch for content the curated nodes don't cover.
`htmlPath` is a relative path under `.anydemo/` to author-written HTML; the
renderer fetches + sanitises before injecting.

```json
{ "id": "legend", "type": "htmlNode", "position": { "x": 50, "y": 600 },
  "data": { "htmlPath": "checkout-flow/legend.html", "width": 400 } }
```

**imageNode** — decorative image at a relative path under `.anydemo/`.

```json
{ "id": "logo", "type": "imageNode", "position": { "x": 0, "y": 0 },
  "data": { "path": "checkout-flow/logo.png", "alt": "Stripe logo" } }
```

### Connectors

Always discriminated on `kind`. Required: `id`, `source`, `target`.

```json
{ "id": "c1", "kind": "http",    "source": "checkout-api", "target": "payments",
  "method": "POST", "url": "/charge", "label": "POST /charge" }
{ "id": "c2", "kind": "event",   "source": "checkout-api", "target": "shipping-worker",
  "eventName": "order.created" }
{ "id": "c3", "kind": "queue",   "source": "checkout-api", "target": "fulfil-queue",
  "queueName": "fulfilment-jobs" }
{ "id": "c4", "kind": "default", "source": "user-icon",    "target": "checkout-api",
  "label": "clicks checkout" }
```

Optional visual fields apply to every kind: `style` (`solid|dashed|dotted`),
`direction` (`forward|backward|both|none`), `path` (`curve|step`),
`color`, `borderSize`, `fontSize`, `label`,
`sourceHandle`/`targetHandle` (`r|b` for source, `t|l` for target).

### `stateSource`

Discriminated union with two members:

```json
{ "kind": "request" }   // node fires in response to an explicit caller
{ "kind": "event" }     // node fires off an event / async signal
```

Pick `request` for nodes you click (endpoints, triggers). Pick `event` for
consumers, workers, DBs, watchers — anything that fires reactively.

### `playAction` / `statusAction` / `resetAction`

All three are `ScriptAction` shapes:

```json
{ "kind": "script", "interpreter": "bun", "args": ["run"],
  "scriptPath": "<slug>/scripts/<file>.ts", "input": {…optional…},
  "timeoutMs": 15000 }
```

Constraints:

- `scriptPath` MUST be a relative path under `.anydemo/`. No leading slash,
  no `..` traversal, no Windows-style drive letters.
- `interpreter` is whatever the studio can exec. Common: `bun`, `node`,
  `python3`, `bash`.
- `args` (optional) prepend before the script path:
  `bun run <scriptPath>` or `python3 -u <scriptPath>`.
- `input` (playAction only) is JSON-serialised and piped to the child's
  stdin then closed. The child reads from stdin with `Bun.stdin.text()` /
  `process.stdin` / `sys.stdin.read()`.
- `timeoutMs` (playAction; max 600_000) caps spawn lifetime.
- `maxLifetimeMs` (statusAction; max 3_600_000) caps continuous-tick
  lifetime. Default: 600_000 (10 min). Bump to 1_800_000 for long-async
  workflow demos.

### `StatusReport` (stdout line shape)

Every statusAction stdout line MUST validate as:

```json
{ "state": "ok|warn|error|pending", "summary": "…(≤120)…",
  "detail": "…(≤2000)…", "data": {…free…}, "ts": 1700000000000 }
```

Malformed lines are silently dropped by the studio. Always emit one full
JSON object per line.

---

## Sub-agent reference

| Agent | Tools | Used for |
|---|---|---|
| `anydemo-discoverer` | `Read, Grep, Glob, LS, Bash` (read-only) | Phase 1: explore codebase, return context brief |
| `anydemo-node-planner` | (none — pure reasoning) | Phase 2: pick nodes + connectors from brief |
| `anydemo-play-designer` | `Read, Grep, Glob, LS` | Phase 3: design playActions + script bodies |
| `anydemo-status-designer` | `Read, Grep, Glob, LS` | Phase 3: design statusActions + script bodies |

Each agent's full system prompt + worked example lives in
`agents/<agent>.md`. All four sub-agents share the same `examples/order-pipeline`
worked example — when refactoring any one, keep the four in lockstep.

## Studio API touchpoints

| Endpoint | Method | Phase | Body |
|---|---|---|---|
| `/health` | GET | 0 | — |
| `/api/demos/register` | POST | 5 | `{name, repoPath, demoPath}` |
| `/api/demos/:id` | GET | 6 | — |
| `/api/demos/:id/play/:nodeId` | POST | 6 | — |
| `/api/events?demoId=:id` | GET (SSE) | 6 | — |
| `/api/demos/:id` | DELETE | rollback only | — |

The plugin never invents new endpoints. Anything you can't do with this
table is out of scope for this skill — surface it to the user.
