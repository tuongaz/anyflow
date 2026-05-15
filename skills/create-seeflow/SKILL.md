---
name: create-seeflow
description: Use when the user asks to create, generate, or scaffold an SeeFlow flow from a natural-language prompt (triggers like "create a demo", "show how X works", "make me a flow of Y", "diagram our checkout system"). Orchestrates four sub-agents and bun scripts to write a registered, validated demo under <project>/.seeflow/<slug>/.
---

# create-seeflow

Turn a natural-language prompt ("show how checkout works") into a registered,
runnable, validated SeeFlow flow under `<project>/.seeflow/<slug>/`. You — the
main thread — orchestrate four sub-agents and a handful of bun scripts; you
never read the user's codebase directly.

## When to invoke

You are invoked by description. In any project, just run:

```
/create-seeflow Create a flow showing how the order pipeline works
/create-seeflow Show how checkout works end to end
/create-seeflow Diagram our event-driven notification system
```

Trigger phrases include:

- "create a demo of X" / "make me a flow of Y" / "diagram our X system"
- "show how X works" / "visualise X" / "scaffold a demo for X"
- "add another demo to this repo" (edit / multi-demo case)

Stop and ask for clarification only when the prompt is incoherent — never ask
"what is your codebase?". The discoverer's job is to figure that out.

## Inputs you have

- The user's full natural-language prompt.
- The project root (`$PWD` at invocation — the directory the user is in).
- `~/.seeflow/config.json` (optional; supplies studio host:port, default
  `http://localhost:4321`).
- Existing `<project>/.seeflow/<slug>/demo.json` files, if any (multi-demo
  per project is supported; check before creating).

## The pipeline

```
Phase 0 — pre-flight: studio reachable?
Phase 1 — seeflow-discoverer        → context brief (language + runtime + tests)
Phase 2 — seeflow-node-planner      → node draft
Phase 2b— write skeleton demo.json (nodes only) → register → user reviews canvas → approval
Phase 3 — seeflow-play-designer  ┐
          seeflow-status-designer├ parallel → overlays
                                 ┘
Phase 4 — synthesize → validate-schema
Phase 5 — write script files → re-register full demo
Phase 6 — validate-end-to-end.ts → trigger APIs → verify via SSE (retry up to 2x)
Phase 7 — open browser on success / retry-or-stop on failure
```

Each phase is **gated** on the previous one. Do not start Phase N+1 until
Phase N has succeeded.

---

## Core rule — no mocks, ever

**NEVER write a script that mocks a service, fakes a response, or simulates
what a real service would return.** There is no value in a demo that talks
to itself. If a service cannot be reached, the demo is broken — not something
to paper over with a fake.

Scripts have exactly two purposes:

1. **Trigger a real service** — call an actual running endpoint, drop a real
   file into a watched directory, publish a real event to a real broker.
   The only "invented" content allowed here is *input data* that is needed
   to fire the trigger: a sample cart payload, a fixture file written to a
   bucket, a synthetic webhook body. The data is invented; the service that
   receives it is real.

2. **Read real resource state** — query an actual database, poll an actual
   queue depth, call an actual health endpoint. Report what the real system
   says; never fabricate a state.

If a required service is not running and cannot be started locally, **stop
and ask the user** — ask them how to start it, whether there is a local
equivalent, or whether this node should be skipped. Do not invent a
workaround. A demo with one honest gap is better than a demo that silently
lies about its own behavior.

---

## Core rule — see the bigger picture before inserting data

**Before writing a play script that INSERTs rows into a database, publishes
directly to a queue, or writes records to a store, stop and ask: does the
system already have a natural path for getting that data in?**

Direct inserts bypass validation logic, business rules, and the very code
paths the demo is meant to illuminate. They also produce demos that look
artificial — the audience watches a raw SQL call instead of the real flow.
Only use direct inserts when no other path exists.

**Check these patterns first (ask the discoverer to surface them):**

| Pattern | What to look for | Play action to use instead |
|---|---|---|
| **API endpoint** | A REST/gRPC/GraphQL endpoint that accepts the data | Call the endpoint (this is what users do in production) |
| **File-drop processor** | A file watcher / `inotify` / `fsnotify` / S3-event listener that reads dropped files and loads them | Drop a real fixture file into the watched directory or bucket |
| **Event/message producer** | A publisher service, CLI command, or webhook sender that writes to the queue/topic | Trigger the producer, not the queue directly |
| **Seed / fixture command** | `make seed`, `bun run seed`, `./scripts/seed.sh`, ORM factory | Run the seed command — it already knows the correct shape |
| **Webhook receiver** | An inbound webhook endpoint (`/webhooks/stripe`, `/events/github`) that parses the body and writes to the DB | POST a synthetic webhook body to the receiver |
| **Admin / backoffice API** | An internal admin endpoint or gRPC method for creating records | Use it — it exists for exactly this purpose |
| **File-based import** | A CSV/JSON/NDJSON import endpoint or CLI that bulk-loads records | Drop a fixture file or call the import endpoint |

**Examples of what this looks like in practice:**

- An order-pipeline demo needs an order in the DB → don't INSERT; call
  `POST /api/orders` with a fixture body. The API validates, emits events, and
  writes the row — the demo now shows the full intake path.
- A data-warehouse pipeline needs rows in a staging table → don't INSERT; drop
  a CSV fixture into the S3-compatible watched bucket. The file-processor picks
  it up, transforms, and loads — the demo shows the ETL entry point.
- A notification system needs a message in the queue → don't publish directly;
  call the trigger service (`POST /api/notify`) which publishes on behalf of the
  caller — the demo shows the producer, not a hidden bypass.
- A recommendation engine needs user-event data → don't INSERT; fire a
  synthetic `track` event at the analytics endpoint. The pipeline picks it up
  and feeds the engine — the demo shows end-to-end ingestion.

If none of the above patterns exist (truly no higher-level entry point),
document the reason in `rationale` and only then resort to a direct
INSERT/PUBLISH, clearly scoped to the minimum data needed.

---

## Core rule — match the project's primary language

**ALWAYS write scripts in the project's primary language when a runtime for
that language is available.** The discoverer surfaces `runtimeProfile.primaryLanguage`
in Phase 1 — use it as the default interpreter for every play and status
script the designers produce in Phase 3.

The practical reason: the project already has types, helpers, clients, and
fixtures written in that language. Re-using them makes scripts shorter, more
robust, and easier for the demo owner to maintain. A Bun/TypeScript app has
`fetch`, typed payloads, and existing service clients; a Go app has its own
HTTP clients and structs. Throwing away all of that by switching to bash or
Python costs more than it saves.

**Language → interpreter mapping (use these unless the runtime is absent):**

| `primaryLanguage` | `interpreter` | `args` |
|---|---|---|
| `typescript` / `javascript` | `bun` | `["run"]` |
| `go` | `go` | `["run"]` |
| `python` | `python3` | `["-u"]` |
| `ruby` | `ruby` | `[]` |
| `java` / `kotlin` | `kotlinc` or `java` | depends on build tool |
| `rust` | `cargo` | `["script"]` (if available) |

**Worked examples:**

*TypeScript app* — call the real checkout endpoint using the project's own
type definitions:
```typescript
// .seeflow/checkout-flow/scripts/play-checkout.ts
import type { CartPayload } from "../../src/types"; // reuse project types
const input: CartPayload = JSON.parse(await Bun.stdin.text());
const res = await fetch("http://localhost:3001/checkout", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(input),
});
console.log(await res.json());
```

*Go app* — use the project's existing models and HTTP client:
```go
// .seeflow/order-flow/scripts/play-order.go
package main
import (
    "encoding/json"
    "fmt"
    "net/http"
    "bytes"
    "os"
)
func main() {
    var payload map[string]any
    json.NewDecoder(os.Stdin).Decode(&payload)
    body, _ := json.Marshal(payload)
    res, _ := http.Post("http://localhost:8080/orders", "application/json", bytes.NewReader(body))
    var out any
    json.NewDecoder(res.Body).Decode(&out)
    fmt.Println(out)
}
```

**Fallback:** Only use `bash` or `python3` when the project language has no
scriptable runtime (e.g. a Java monolith with no `jbang`/`kotlinc` available)
or when the script logic is trivially simple (`curl` one-liner). If you fall
back, note the reason in `rationale`.

---

## Phase 0 — pre-flight (studio reachable)

Resolve the studio URL: prefer `SEEFLOW_STUDIO_URL` env var, else
`~/.seeflow/config.json`'s `port` field, else default `http://localhost:4321`.
Then:

```bash
curl --max-time 0.5 -fsS "$STUDIO_URL/health"
```

On any failure (connection refused, timeout, non-2xx):

1. Check whether the `seeflow` CLI is installed:

```bash
which seeflow
```

2. Print the appropriate message and STOP:

   **CLI found** (`which seeflow` exits 0):
   ```
   Studio not reachable at <url>. Start it with:

     seeflow start
   ```

   **CLI not found** (`which seeflow` exits non-zero):
   ```
   Studio not reachable at <url> and the seeflow CLI is not installed.

   To get started, either:

     npx @tuongaz/seeflow       # run without installing

   or check out the repo and run:

     git clone https://github.com/tuongaz/seeflow.git
     cd seeflow
     make dev                   # starts studio at http://localhost:4321
   ```

Do not retry. Do not auto-start. The user must launch the studio themselves.

On success: continue to Phase 1.

---

## General rule — use subagents to parallelise wherever possible

Whenever two or more units of work are independent of each other, dispatch them
as concurrent subagents in a single message rather than running them serially.
This applies beyond Phase 3: if you need to fix multiple failing scripts in
Phase 6, or re-run multiple designers in Phase 4, send all the sub-agent
`Task` calls at once. Serial execution should be the exception (needed only
when output of one step is required as input to the next), not the default.

---

## After Phase 0 — list tasks

Before launching any sub-agent, create a TodoWrite checklist so the user can
track progress in real time. Create one todo per phase using `TaskCreate`:

```
[ ] Phase 1  — Discover codebase (language, runtime, integration tests)
[ ] Phase 2  — Plan nodes & connectors
[ ] Phase 2b — Register skeleton demo (nodes only) — await user node review
[ ] Phase 3  — Design Play + Status scripts (parallel)
[ ] Phase 4  — Synthesize & validate schema
[ ] Phase 5  — Write script files & re-register full demo
[ ] Phase 6  — End-to-end validation (trigger APIs, verify via SSE)
[ ] Phase 7  — Open browser
```

Mark each todo complete (via `TaskUpdate`) immediately after the phase
succeeds — before starting the next one. This gives the user a live view of
where the pipeline is.

---

## Phase 1 — discover

Launch the `seeflow-discoverer` sub-agent with the user's prompt, the project
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

Launch `seeflow-node-planner` with the context brief. The planner has **no
tools** — it reasons purely from the brief. It applies two mandatory passes:

- **Resource nodes first** — every DB, queue, event bus, cache, file store,
  and external SaaS touched by the flow gets its own `stateNode`, whether
  named in `rootEntities` or inferred from service behavior.
- **Abstraction rules second** — one node per service / workflow / worker /
  queue / DB (exceptions: independently-meaningful pipeline stages, fan-out
  consumers, branches).
- **Connection limit** — each node should have at most **4 total connections**
  (incoming + outgoing combined). A node with more connections is visually
  overwhelming and signals a design problem. When a node would exceed the limit:
  - **Split** it into two nodes if it has distinct responsibilities (e.g.
    "API gateway — auth" vs "API gateway — routing").
  - **Duplicate** a shared resource (see below) to break hub-and-spoke patterns.
  - **Group** related nodes inside a `group` node and show one connector to
    the group instead of N connectors to its children.

Expected output:

```json
{
  "name": "…",
  "slug": "…",
  "nodes": [{ "id": "…", "type": "…", "data": {…}, "oneNodeRationale": "…" }],
  "connectors": [{ "id": "…", "kind": "…", "source": "…", "target": "…" }]
}
```

**Duplication for clarity** — the "one node per service" default can be
overridden when showing the same service or resource more than once makes the
diagram easier to follow. This is preferable to drawing crossing connectors or
forcing a single node to have many connections. Rules for duplicating:

- Use the same `kind` and `name` as the original node.
- Give each copy a unique `id` with a descriptive suffix
  (e.g. `"orders-db-write"`, `"orders-db-read"`).
- Prefer duplication on **shared resources** (databases, caches, queues) that
  appear in multiple independent flows side by side.

Same retry budget: one retry on unparseable output, then surface and stop.

---

## Phase 2b — node review checkpoint

Before designing any scripts, register a **skeleton** demo (nodes + connectors only,
no `playAction` / `statusAction`) so the user can review the canvas layout and catch
structural problems early. Do not skip this step.

1. Build a skeleton `Demo` JSON from the node draft — omit all `playAction`,
   `statusAction`, and `resetAction` fields. Keep `version`, `name`, `nodes`,
   and `connectors`.
2. Write it to a temp path: `/tmp/seeflow-<slug>-nodes.json`.
3. Validate schema:
   ```bash
   bun skills/create-seeflow/scripts/validate-schema.ts /tmp/seeflow-<slug>-nodes.json
   ```
   On failure: fix the field-level issues (do not re-run the node-planner), then retry.
4. Write `$demoDir/demo.json` with the skeleton and register:
   ```bash
   bun skills/create-seeflow/scripts/register.ts --path "$repoPath" --demo "$demoPath"
   ```
   Stash the `id` returned — you will reuse it in Phases 5 and 6.
5. Open the studio URL in the user's browser:
   ```bash
   url="$STUDIO_URL/d/<slug>"
   case "$(uname)" in Darwin) open "$url";; Linux) xdg-open "$url";; esac
   ```
6. Ask the user:

   > The nodes are registered — please review the canvas at `<url>`.
   > Do the nodes and layout look right? Any additions, removals, or renames before
   > I start writing the play/status scripts?

**Wait** for the user's response before proceeding to Phase 3.

- **User approves** → continue to Phase 3.
- **User requests changes** → collect all feedback, loop back to Phase 2 (re-run the
  node-planner sub-agent with the user's corrections), then repeat Phase 2b.

---

## Phase 3 — design Play + status (parallel)

Launch `seeflow-play-designer` and `seeflow-status-designer` **in parallel**
(send a single message with two `Task` tool calls; do not serialise them).
Both receive the same input: the context brief + the node draft + the edit
target (if any). Both have read-only file tools (`Read`, `Grep`, `Glob`,
`LS`).

`seeflow-play-designer` returns:

```json
{
  "playOverlays": [{
    "nodeId": "…",
    "playAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                    "scriptPath": "<slug>/scripts/<name>.ts",
                    "input": {…}, "timeoutMs": 30000 },
    "scriptBody": "<full bun/python/node source as a string>",
    "validationSafe": true,
    "rationale": "…"
  }],
  "newTriggerNodes": []
}
```

`seeflow-status-designer` returns:

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

**Sample data — look before inventing.** Before authoring any `input` payload
or fixture data, the play-designer MUST search the project for existing data
shapes. The discoverer surfaces `runtimeProfile.integrationTestDir` and
`runtimeProfile.setupPattern` — use them as the starting point. Priority order:

1. **Integration / e2e test fixtures** — copy payload shapes verbatim; they
   are guaranteed to work against the real service.
2. **Seed files or migration fixtures** — look for `seed.*`, `fixtures/`,
   `testdata/`, or ORM factory files; extract realistic field values.
3. **Documentation examples** — README / OpenAPI / Postman collections;
   adapt the example body.
4. **Invent only as a last resort** — and note in `rationale` that no
   existing fixture was found.

Using real fixture shapes (rather than `{"foo": "bar"}` placeholders) means
the play script is more likely to pass real validation and more educational
for the demo audience.

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
   metadata that the schema does NOT accept. Collect every `nodeId` where
   `validationSafe: false` into a list called `unsafeNodeIds` (used in
   Phase 6 to tell the validator which nodes to skip).
3. **Write** the merged `Demo` to a temporary path
   (e.g. `/tmp/seeflow-<slug>-draft.json`).
4. **Validate** locally:

```bash
bun skills/create-seeflow/scripts/validate-schema.ts /tmp/seeflow-<slug>-draft.json
```

Exit 0 with `{"ok":true}` → continue. Exit 1 with `{"ok":false,"issues":[…]}`
→ feed the issues back to the relevant sub-agent (play-designer if a play
field; status-designer if a status field; node-planner otherwise) and retry.
**Max 3 schema retries** before surfacing the raw issue list verbatim to the
user and stopping.

5. Proceed directly to Phase 5 — the user already reviewed and approved the
   node layout in Phase 2b, so no additional confirmation is needed here.

A worked plan example lives at `references/examples/checkout-flow-plan.md`
(informational only — no longer shown to the user).

---

## Phase 5 — write script files + re-register full demo

Proceed immediately after Phase 4 schema validation passes.

1. **Compute paths**: `repoPath = $PWD`,
   `demoDir = $PWD/.seeflow/<slug>`,
   `demoPath = .seeflow/<slug>/demo.json` (relative — that is what
   `register.ts` posts).
2. **Create dirs**: `mkdir -p $demoDir/scripts $demoDir/state`.
3. **Write the files** (overwriting the skeleton `demo.json` written in Phase 2b):
   - `$demoDir/demo.json` — the fully-validated `Demo` object (pretty-printed),
     now including all `playAction` and `statusAction` fields.
   - `$demoDir/scripts/<playScriptName>` — one file per playOverlay
     `scriptBody`. Mark executable (`chmod +x`).
   - `$demoDir/scripts/<statusScriptName>` — one file per statusOverlay
     `scriptBody`. Mark executable.
   - `$demoDir/state/.gitignore` — `*` (state files are runtime-only).
4. **Re-register** (updates the studio with the full demo):

```bash
bun skills/create-seeflow/scripts/register.ts --path "$repoPath" --demo "$demoPath"
```

The script POSTs `{name, repoPath, demoPath}` to `/api/demos/register` and
prints `{id, slug}` to stdout. The `id` from Phase 2b is superseded — use the
new `id` for Phase 6 + Phase 7.

If `register.ts` exits non-zero with a 400 body: show the body verbatim, ask
the user whether to fix-and-retry (loop back to Phase 4) or stop. On any
other 4xx/5xx: print the body and stop — the studio is in an unexpected
state.

---

## Phase 6 — end-to-end validation

This phase MUST run. Do not skip it, do not simulate it, do not report
success without running the script and reading its output.

```bash
# Pass --skip-nodes only when unsafeNodeIds is non-empty (comma-separated list)
bun skills/create-seeflow/scripts/validate-end-to-end.ts <id> [--skip-nodes <nodeId1>,<nodeId2>]
```

`unsafeNodeIds` was built in Phase 4 from `playOverlays` entries where `validationSafe: false`.
Pass them here so the validator skips nodes that hit real third-party services, charge real money,
or cannot safely be triggered automatically. Nodes in `unsafeNodeIds` appear in the
`skipped[]` output and are NOT counted as failures.

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
3. **If more than one script needs fixing, dispatch subagents in parallel** —
   send one `Task` call per failing script in a single message so fixes are
   authored concurrently. Wait for all to complete before writing the files
   and re-running validation.
4. Edit the failing scripts in-place, then re-run Phase 6 against the same
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
| Studio `/health` fails (Phase 0) | Check `which seeflow`; if found tell user `seeflow start`; if not found tell user `npx @tuongaz/seeflow` or `git clone https://github.com/tuongaz/seeflow.git && cd seeflow && make dev`. No retry. |
| Sub-agent returns unparseable output | Retry the sub-agent once with the parse error; if it fails again, surface to user and stop. |
| Schema validation fails (Phase 4) | Loop back to the relevant designer with the Zod issue list. Max 3 retries; then surface issues verbatim. |
| Register 400 (Phase 5) | Show response body; ask user "fix-and-retry / stop". |
| Register 4xx/5xx other (Phase 5) | Show response body; stop. |
| Play returns `{error: "…"}` (Phase 6) | Edit the failing scripts in-place; re-run Phase 6 (max 2 retries). Do NOT re-run Phase 4 or re-register. |
| Status SSE timeout 10s (Phase 6) | Mark node `no status received`; include in fix-up reasoning or ask user retry/stop. |
| Validation total >2 min (Phase 6) | Script SIGTERMs in-flight checks and exits with `ok:false`; treat as failure → fix-up path. |

Two retry budgets, both hard caps:

- **Phase 4 schema retries** — max **3** before surfacing.
- **Phase 6 fix-up retries** — max **2** before asking the user.

---

## Schema cheatsheet

The full Zod schema lives at `skills/create-seeflow/vendored/schema.ts`. Read
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
                    "timeoutMs": 30000 },
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
    "name": "Orders DB", "kind": "db",
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
`htmlPath` is a relative path under `.seeflow/` to author-written HTML; the
renderer fetches + sanitises before injecting.

```json
{ "id": "legend", "type": "htmlNode", "position": { "x": 50, "y": 600 },
  "data": { "htmlPath": "checkout-flow/legend.html", "width": 400 } }
```

**imageNode** — decorative image at a relative path under `.seeflow/`.

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

- `scriptPath` MUST be a relative path under `.seeflow/`. No leading slash,
  no `..` traversal, no Windows-style drive letters.
- `interpreter` MUST match `runtimeProfile.primaryLanguage` (see "Core rule —
  match the project's primary language"). Fallback to `bash`/`python3` only
  when the project runtime cannot execute scripts directly. Common values:
  `bun`, `go`, `python3`, `node`, `bash`.
- `args` (optional) prepend before the script path:
  `bun run <scriptPath>` or `python3 -u <scriptPath>`.
- `input` (playAction only) is JSON-serialised and piped to the child's
  stdin then closed. The child reads from stdin with `Bun.stdin.text()` /
  `process.stdin` / `sys.stdin.read()`.
- `timeoutMs` (playAction; max 600_000) caps spawn lifetime. **Be generous:**
  - Simple HTTP call → 15 000 ms is fine.
  - Go / Rust (compile on first run) → minimum **60 000 ms**, recommend **120 000 ms**.
  - Java / Kotlin (JVM startup + compile) → minimum **120 000 ms**.
  - Any script that seeds a database or runs migrations → **60 000 ms** minimum.
  When in doubt, err on the side of a longer timeout; a script that completes
  early is fine, but one that times out mid-execution leaves the demo in a broken
  state that is harder to debug.
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
| `seeflow-discoverer` | `Read, Grep, Glob, LS, Bash` (read-only) | Phase 1: explore codebase, return context brief |
| `seeflow-node-planner` | (none — pure reasoning) | Phase 2: pick nodes + connectors from brief |
| `seeflow-play-designer` | `Read, Grep, Glob, LS` | Phase 3: design playActions + script bodies |
| `seeflow-status-designer` | `Read, Grep, Glob, LS` | Phase 3: design statusActions + script bodies |

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
