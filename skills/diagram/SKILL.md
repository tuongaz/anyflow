---
name: anydemo-diagram
description: This skill should be used when the user asks to "show me the architecture", "diagram this codebase", "explain how X works", "make a playable diagram", "generate an anydemo", "show me the order pipeline", "diagram the auth flow", or any request to produce a single flat playable architecture diagram for the AnyDemo studio. Drives a pre-flight + 8-phase pipeline (scan → scope → tier → nodes → wiring → layout → assemble → register) with three user checkpoints.
version: 0.1.0
argument-hint: "[free-text request] [--scope=<name>] [--tier=real|mock|static]"
---

# AnyDemo Diagram Generator

Generate a single flat playable AnyDemo diagram (`<target>/.anydemo/demo.json`)
from any codebase. The output is schema-valid, has ≤30 nodes, and registers
with the running studio so the user can click the result.

## Requirements

- A running AnyDemo studio reachable at `$ANYDEMO_STUDIO_URL` (default
  `http://localhost:4321`). The skill probes `GET /health` as its very
  first action (see "Studio precheck" below) and STOPS with a
  user-facing start instruction if the probe fails — start the studio
  with `npx @tuongaz/anydemo start` (npm install) or `bun run dev`
  (monorepo checkout) before re-running.
- **Node.js** (any LTS) on `PATH` — the two filesystem scripts under
  `$SKILL_DIR/scripts/` run on Node. `$PLUGIN_ROOT` and `$SKILL_DIR` are
  resolved in Phase 0; they handle both the plugin install at
  `~/.claude/plugins/anydemo-diagram/` and the flat-skill install at
  `~/.claude/skills/anydemo-diagram/`.
- `curl` and `jq` for the HTTP calls below.

All schema validation, scope scoring, demo assembly, and registration happen
**via the studio's HTTP API**. The skill ships two small Node scripts that
walk the user's `$TARGET` filesystem; everything else is a `curl` call.

## Path convention in this document

Bare relative paths in prose (`references/demo-schema.md`,
`agents/wiring-builder.md`, `scripts/scan-target.mjs`) are relative to
`$SKILL_DIR`, the skill's content root. `$SKILL_DIR` is resolved in
Phase 0 and points at either `$PLUGIN_ROOT/skills/diagram/` (plugin
install) or `$PLUGIN_ROOT/` (flat-skill install). Code blocks that need
to resolve a path on disk use the explicit `$SKILL_DIR/...` form.

## Announcement

Announce: "Using anydemo-diagram skill to generate a playable diagram for: <request>"

## Studio precheck — before any phase

The studio MUST be running before any phase executes; every
non-filesystem step in the pipeline is an HTTP call into it. **Run
this check BEFORE Phase 0** (and before any other Bash tool call in
the skill):

```bash
STUDIO_URL="${ANYDEMO_STUDIO_URL:-http://localhost:4321}"
curl -fsS --max-time 3 "$STUDIO_URL/health" >/dev/null 2>&1
```

If the check exits non-zero, **STOP the skill** and tell the user in
plain prose (not a stack trace or a bash dump). Use this template,
substituting `$STUDIO_URL`:

> The AnyDemo studio is not running at `<STUDIO_URL>`. Start it in a
> separate terminal with one of:
>
> ```
> npx @tuongaz/anydemo start
> ```
>
> (uses the published npm package — the default for most users), or
> from inside an AnyDemo monorepo checkout:
>
> ```
> bun run dev
> ```
>
> Then re-run `/diagram` (or the request that triggered this skill).
> If the studio is on a non-default host/port, set
> `ANYDEMO_STUDIO_URL=http://host:port` before re-running.

Do NOT attempt to start the studio yourself with `Bash`
(`run_in_background` or otherwise) — the user owns the studio
process so they can see its output, restart it, and clean up cleanly.
Starting it from inside the skill creates an orphan process the user
can't kill.

If the check passes, proceed to Phase 0. Phase 0 re-probes
`/health` as a safety net (so the orchestration is robust if the
studio dies mid-run), but the precheck above is the user-facing
gate.

## Trigger examples

Invoke this skill (or run `/diagram <request>`) for any of these — they all
work for any codebase, any team, any language the framework hints support:

- "diagram this codebase"
- "show me the order pipeline"
- "explain how auth works as a playable diagram"
- "make me an anydemo of the checkout flow"
- "I want a tier-2 mock diagram of the ingest worker"
- "render the public API surface"

## Inputs

- **Free-text request** — `$ARGUMENTS` (e.g. "show me the order pipeline")
- **`--scope=<name>`** (optional) — pre-selects a slice; skips Checkpoint 1
- **`--tier=real|mock|static`** (optional) — pre-selects the tier; skips Checkpoint 2
- **Target repo** — defaults to `cwd`. Override by `cd`-ing first.

## Pipeline overview

```
Phase 0  Pre-flight     (deterministic; no LLM)
Phase 1  SCAN           node scan-target.mjs + node extract-routes.mjs
                        + POST /api/diagram/propose-scope
                        → target-scanner agent for semantic summary
Phase 2  SCOPE          scope-proposer agent
                        ── CHECKPOINT 1 (AskUserQuestion: approve/refine scope)
Phase 3  TIER           tier-detector agent
                        ── CHECKPOINT 2 (AskUserQuestion: pick tier)
Phase 4  NODE SELECTION node-selector agent (≤30 nodes; folds long tail)
                        ── CHECKPOINT 3 (AskUserQuestion: confirm node list)
Phase 5  WIRING         wiring-builder agent (+ harness-author if Tier 2)
Phase 6  LAYOUT         layout-arranger agent
Phase 7  ASSEMBLE       POST /api/diagram/assemble
                        + POST /api/demos/validate
Phase 8  REGISTER       POST /api/demos/register
```

Each agent reads a small set of intermediate JSON files and writes one back.
The orchestrator (this file) coordinates the phases and surfaces checkpoints.

## Demo Schema Reference

The studio's `/api/demos/validate` and `/api/demos/register` endpoints reject
anything that doesn't match the demo schema exactly.

**The full schema, every node and connector variant, the canonical valid
demo example, and the list of common rejection causes live in
`references/demo-schema.md`.** Read that file before emitting any JSON in
Phases 5, 6, or 7. The schema is authoritative — do not infer fields.

Quick guarantees from the schema (every emitter must satisfy these):

- `version` is the literal `1`.
- `name` is a non-empty string (otherwise the demo registers as "Untitled
  diagram").
- Every node `id` is unique. Connectors reference `source` and `target`
  (not `from`/`to`) and every id must match an existing node.
- `playNode` REQUIRES `playAction`; `kind: 'event'` REQUIRES `eventName`;
  `kind: 'queue'` REQUIRES `queueName`.
- Handle role: `sourceHandle` ∈ `{r, b}`, `targetHandle` ∈ `{t, l}`. Cross
  values are rejected.

### Two flavors of runnable node — triggers and observers

A "dynamic" or "runnable" node is anything the reader perceives
behavior from at runtime. The schema supports two distinct flavors,
and a good diagram almost always contains BOTH paired together:

- **Trigger nodes (`playNode`)** — clickable boxes that fire an HTTP
  request when the user presses them. They have a `playAction` and
  represent the user's "do something" affordance: call an API,
  upload a file, replay an event, run a job. The studio renders a
  Play button on each one.
- **Observer nodes (`stateNode` with `stateSource: { kind: 'event' }`)**
  — non-clickable boxes that display the state of a downstream
  resource. The studio animates them: idle by default, **spinner /
  waiting** when an upstream `emit()` reports `running`, **green
  tick** on `done`, red on `error`. They represent the *consequence*
  of a trigger — the database row that gets written, the S3 object
  that arrives, the queue message that gets consumed, the email
  that gets sent.

**Pair only across real seams.** Apply the abstraction rule ("Pick
the right abstraction", below) FIRST to decide what counts as a node,
then add observers for async consequences that cross those seams.
An S3 bucket downstream of an "Upload file" trigger is a real seam —
pair it. An auth middleware downstream of a `POST /orders` handler is
not — collapse it into the handler's description, do not give it an
observer.

Canonical pairing: a user clicks a **trigger** `playNode` labeled
"Upload file"; the request flows through the harness; the harness
emits `running` then `done` to a downstream **observer** `stateNode`
labeled "S3 bucket". The reader watches the S3 box flip from spinner
to green tick — visible confirmation the file arrived.

Add an observer alongside a trigger when:

- The trigger lands in a store the reader cares about (DB row,
  cache write, S3 object).
- The trigger publishes an event/queue message that another part of
  the system reacts to.
- The trigger kicks off async work (a worker run, a scheduled job)
  whose completion the reader wants to see.
- The trigger has a side effect a reader would want to confirm
  visibly (email sent, webhook fired, notification posted).

Skip the observer when:

- The trigger is purely synchronous and returns the result inline
  (a math endpoint, a validation check). The `playNode`'s own
  request-state animation is enough.
- The downstream resource is already drawn as a duplicated
  cross-cutting node for visual clarity and adds no new information.

How the pipeline produces the pair:

- **Phase 4 (node-selector)** classifies candidates as `dynamic-play`
  (becomes `playNode`) vs `dynamic-event` (becomes observer
  `stateNode`). For every `dynamic-play` whose work has an observable
  consequence, also propose the matching `dynamic-event` observer.
- **Phase 5 (wiring-builder)** wires the pair with a connector —
  `kind: 'event'` if the trigger emits a named event,
  `kind: 'queue'` if it publishes to a queue, `kind: 'default'`
  for plain read/write.
- **Phase 5b (harness-author, Tier 2)** drives the observer by
  calling `emit(demoId, observerNodeId, 'running')` immediately
  and `emit(..., 'done')` when the bridge (CLI spawn, container
  exec, broker publish, file drop, …) completes. On Tier 1, the
  user's app must call `emit()` itself for the observer to animate.

### Two descriptions: short on the node, long in the panel

`data.detail` has **two free-text description fields** — both optional, both
emitted by Phase 5:

- **`summary`** — the SHORT description rendered ON the node itself, inside
  the box. **MUST be concise** so it fits without wrapping into a wall of
  text. Target ≤ 60 characters / one short sentence. Examples: `"Creates
  an order row and emits orders.created."`, `"Reads pending shipments."`,
  `"Stores user accounts."`. Avoid run-on prose, code spans, or
  multi-clause sentences here — those go in `description`.
- **`description`** — the LONG description rendered in the right-hand
  detail panel when the user clicks the node. Use full sentences,
  multi-paragraph context, edge cases, links to the source path, gotchas
  worth surfacing. The panel falls back to `summary` when `description`
  is absent, so authoring only `summary` is valid (and matches pre-v0.2
  demos) — but a node worth selecting almost always deserves the longer
  form too.

Rule of thumb: if a reader can absorb the box's purpose without selecting
it, `summary` is doing its job. If they have to click to know what's going
on, `summary` was too long or too vague.

### Node colors — encode risk and trust, not decoration

The schema accepts a small palette on every node's `borderColor` (and
`backgroundColor`): `default`, `slate`, `blue`, `green`, `amber`, `red`,
`purple`, `pink`. **Most nodes should stay `default`.** Apply color only
when it carries semantic meaning a reader can act on at a glance:

- **`borderColor: 'red'`** → sensitive data or high-risk operations.
  Apply to any node that handles PII, secrets, credentials, payment data,
  health records, raw access tokens, or irreversible side effects
  (account deletion, mass payouts, prod migrations). The example to
  internalize: a `stateNode` labeled "Patients" or a `playNode` posting
  raw credit-card numbers MUST be red.
- **`borderColor: 'amber'`** → caution. Deprecated routes, rate-limited
  endpoints, flaky upstream services, beta features, anything the reader
  should think twice before exercising.
- **`borderColor: 'purple'`** → privileged / admin surface. Internal-only
  routes, super-user endpoints, ops dashboards.
- **`borderColor: 'pink'`** → external third-party services (Stripe,
  Twilio, Auth0, OpenAI). Visually separates "we own this" from "they
  own this".
- **`borderColor: 'green'`** → public, customer-facing happy path. Use
  sparingly — typically the one or two main entry points.
- **`default` / `slate` / `blue`** → everything else.

Leave `backgroundColor` unset on functional nodes (`playNode` /
`stateNode`); reserve background tinting for `shapeNode` annotations
(sticky callouts, banner headers). **Read
`references/visual-clarity.md` ("Node colors" section) for the full
table, examples per node kind, and connector-color rules** before
emitting wiring.

### Prefer Playable tiers

A playable diagram (Tier 1 real, Tier 2 mock) is dramatically more useful
than a static one — the reader can click a node and watch live state
appear. When a viable choice exists, **prefer Playable over Static**.

**Key insight: Tier 2 is the universal fallback.** The schema only allows
`playAction.kind: 'http'`, but every `playAction.url` points at the
**harness** we generate, not at the target. The harness is a Hono+Bun
process whose handlers can do anything Bun can do — spawn a CLI, drop a
fixture into a watched directory, `docker exec` into a container,
publish to a real broker, `import()` a library function, call a `make`
target, or just return faked JSON. **The target does NOT need
customer-facing HTTP for Tier 2 to work.** That misconception is the
single biggest reason demos get sleepwalked into Tier 3.

Tier selection:

- **Tier 1 (real)** is the gold standard. Pick it whenever
  `tier-evidence.json` shows a reachable dev server on a known port AND
  the diagram's clickable surface is HTTP-native.
- **Tier 2 (mock)** is the strong default for everything else. Pick it
  whenever the project has *any* identifiable trigger surface — HTTP
  route, CLI entry, file watcher, queue/event consumer, container
  entrypoint, library export, scheduled job, or any combination. The
  `tier-detector` records the matched surface in `triggerSurface`; the
  `harness-author` picks the matching bridge pattern.
- **Tier 3 (static)** is the last resort. Pick it ONLY when the project
  has literally no executable surface — pure type definitions,
  schema-only repos, config bundles, docs, design tokens. If the
  project has `package.json#bin`, `scripts.start`, a Dockerfile/CMD,
  exported functions, a queue consumer, a file watcher, or a scheduled
  job, it qualifies for Tier 2.

The harness picks a **bridge pattern** matching the project's natural
trigger surface (one of `http` / `cli` / `file-watch` / `queue` /
`container` / `library` / `scheduled` / `mixed`). The harness is also
allowed to ship **polyglot helper scripts** in the target's own
language — small `*.py` / `*.go` / `*.rb` runners under
`.anydemo/harness/runners/` that the Node handler spawns when the
demo needs an async kick (manually triggering an event, uploading a
file, sending a signal) that's awkward to do from Bun alone. The full
set of bridge patterns and helper-script conventions — for Compose
stacks, file-driven ETL, queue/event-driven services, libraries, CLIs,
MCP servers, and language servers — lives in
**`references/trigger-bridges.md`**. Read it before grading Tier 2
feasibility (Phase 3) or authoring the harness (Phase 5b).

When presenting Checkpoint 2, surface the playable option first and
explain WHY it's the recommendation. Do NOT let the user sleepwalk into
Tier 3 just because the target "isn't a web server" — that's not a
Tier 3 condition.

### Right-size the demo — split, merge, or scope down

A single AnyDemo diagram caps at 30 nodes (Phase 4 enforces it) and reads
best when a human can absorb the whole flow at a glance. When the user's
request implies more — 50+ playable surfaces, three or four independent
user flows, a polyglot stack with dozens of services — do NOT try to
cram everything into one diagram. The scope-proposer surfaces a
right-sizing recommendation at CHECKPOINT 1 before the user has to ask.

Four alternatives, in preference order:

- **Split into multiple demos**, one per user flow / use case.
  "Order placement" + "Fulfillment" + "Refunds" become three separate
  registered demos. Each has its own slug and tells one coherent
  ≤25-node story; cross-references use `shapeNode` placeholders
  labeled with the other demo's name. Pick this when each flow has a
  distinct entry point and the user is exploring the system
  breadth-first.
- **Merge multiple actions into one playable node.** A single `playNode`
  can compress "validate → persist → emit" behind one click whose
  `detail.description` spells out the internal steps. Pick this when
  the user cares about the boundary (the API surface, the entry point)
  not the internals.
- **Promote a sub-cluster to a single static shape.** When the diagram
  drags in a supporting subsystem for context (auth service inside an
  order-pipeline diagram), fold the whole cluster into one `shapeNode`
  / `stateNode` labeled with the subsystem name. Pick this when the
  cluster is context, not the subject.
- **Narrow the scope.** Drop a subsystem the user didn't actually ask
  about. Pick this when scope grew during proposal by reflex, not by
  request.

Trigger: scope-proposer's `estimatedNodeCount` exceeds ~30, OR
`boundary-surfaces.json` shows three or more independent entry-point
clusters, OR the user's request names multiple unrelated flows ("show
me the order pipeline AND the search index AND the billing job"). The
proposal must include a `sizeRecommendation` block naming the preferred
alternative (`split` / `merge` / `promote-to-shape` / `narrow`) and the
natural split / merge lines; CHECKPOINT 1 surfaces the matching
right-sizing option alongside Approve / Expand / Contract / Redirect.

## Pick the right abstraction — hide internals, show seams

A node represents a system at the right zoom level for the **reader**,
not for the implementer. The diagram exists for a teammate asking "what
happens when a user does X?" — not for someone refactoring the
implementation. **Pick the boundary the reader cares about and hide
what's behind it.** Decomposing a single self-contained subsystem into
its internal steps inflates the node count, drowns the real seams, and
rewards the reader for clicking through implementation detail they
didn't ask about.

Canonical trap: a Temporal workflow with twelve activities. DON'T draw
twelve nodes for `validateOrder`, `chargePayment`, `reserveInventory`,
`sendEmail`, and their compensation siblings — DO draw ONE node "Order
workflow (Temporal)" and list the activities in
`data.detail.description`. The same logic applies to Lambda handlers,
DB transactions, middleware chains, React component trees, ETL CLI
invocations, state machines, caching layers, message-broker consumer
groups, auth/IdP handshakes, and MCP/gRPC services.

**Read `references/abstraction-level.md`** for the full DO/DON'T
catalogue across workflow engines, serverless, databases, app code
structure, data pipelines, state/caching, service mesh, protocol
surfaces, message-broker internals, and auth/identity, plus the "when
TO expand internals" criteria.

### The "next adjacent node" test

Before adding a node, ask: **does the next adjacent node belong to a
different owner, a different runtime, or a different network hop?**

- Yes → the seam is real; add the node.
- No → the candidate is an internal step of a single thing; collapse
  it into the parent.

This rule complements "Visual clarity for humans" below: that one says
duplicate cross-cutting infra (databases, caches, auth) so arrows stay
short; this one says collapse self-contained mechanisms (workflows,
transactions, handler chains) so the diagram stays at the right zoom.
Together: **draw shared infrastructure many times; draw private
internals not at all.**

## Visual clarity for humans — duplicate to declutter

Diagrams are read by a human at a glance, not a machine. **Prefer
duplicating a cross-cutting node over piling connectors into it** — a `db`
drawn three times next to its consumers reads instantly; a single `db`
with eight arrows fanning in does not.

Headline rules (Phases 4, 5, 6 each enforce a slice):

- **Fan-in ≥ 3** → duplicate the target, one instance per cluster of
  callers.
- **Cross-cutting infra** (`database`, `cache`, `auth`, `logging`,
  `metrics`, `queue`) → always duplicate, even at 2 callers.
- **What stays single** → user-facing entry points, domain-owning
  services, anything that genuinely is one box per logical thing.
- **Id convention** → suffix with the consumer (`db-orders`,
  `cache-checkout`). Keep `label` identical so the duplicates read as the
  same logical thing.

**Read `references/visual-clarity.md` for the full rule set, worked
examples, and per-phase enforcement notes** before producing a wiring
plan or a layout.

## Phase 0 — Pre-flight

Resolve the target root, the studio URL, **the plugin root, and the skill
content directory**, then prepare directories. `CLAUDE_PLUGIN_ROOT` is only
exported when the skill is invoked as part of a Claude Code plugin — on direct
`/diagram` usage, a flat-skill install, or a vendored checkout it is empty,
which is why this step has a fallback chain that covers both install layouts:

- **Plugin install** — SKILL.md lives at `$PLUGIN_ROOT/skills/diagram/SKILL.md`.
- **Flat-skill install** — SKILL.md lives at `$PLUGIN_ROOT/SKILL.md` (i.e.
  `~/.claude/skills/anydemo-diagram/SKILL.md`); skill assets are at the root.

`$SKILL_DIR` always points at the skill's bundled assets (`scripts/`,
`references/`, `templates/`, `frameworks/`, `agents/`) regardless of install
layout. Use `$SKILL_DIR` for every skill-internal path below; reserve
`$PLUGIN_ROOT` for messages about where the install lives.

```bash
TARGET="${TARGET:-$(pwd)}"
STUDIO_URL="${ANYDEMO_STUDIO_URL:-http://localhost:4321}"

# Resolve plugin/skill root — covers plugin install, flat-skill install, and
# vendored repo. Sets PLUGIN_ROOT (install dir) and SKILL_DIR (skill assets).
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
SKILL_DIR=""

# Pass 1 — plugin/vendored layout: $candidate/skills/diagram/SKILL.md.
for candidate in \
  "${PLUGIN_ROOT}" \
  "$HOME/.claude/plugins/anydemo-diagram" \
  "$(pwd)"; do
  [ -n "$candidate" ] || continue
  if [ -f "$candidate/skills/diagram/SKILL.md" ]; then
    PLUGIN_ROOT="$candidate"
    SKILL_DIR="$candidate/skills/diagram"
    break
  fi
done

# Pass 2 — flat-skill layout: $candidate/SKILL.md.
if [ -z "$SKILL_DIR" ]; then
  for candidate in \
    "${CLAUDE_PLUGIN_ROOT:-}" \
    "$HOME/.claude/skills/anydemo-diagram" \
    "$(pwd)"; do
    [ -n "$candidate" ] || continue
    if [ -f "$candidate/SKILL.md" ]; then
      PLUGIN_ROOT="$candidate"
      SKILL_DIR="$candidate"
      break
    fi
  done
fi

[ -n "$SKILL_DIR" ] || { echo "Cannot locate anydemo-diagram skill — looked under \$CLAUDE_PLUGIN_ROOT, ~/.claude/plugins/anydemo-diagram, ~/.claude/skills/anydemo-diagram, and cwd." >&2; exit 1; }

mkdir -p "$TARGET/.anydemo/intermediate"

# Studio must be reachable — every non-filesystem step is an HTTP call.
# This is a safety-net re-probe; the user-facing precheck (see "Studio
# precheck" above) already gated entry to Phase 0.
curl -fsS --max-time 3 "$STUDIO_URL/health" >/dev/null 2>&1 || {
  cat >&2 <<EOF
AnyDemo studio not reachable at $STUDIO_URL.
Start it in a separate terminal with one of:
  npx @tuongaz/anydemo start          # npm package (most users)
  bun run dev                         # from an AnyDemo monorepo checkout
Or set ANYDEMO_STUDIO_URL=http://host:port if it lives elsewhere.
EOF
  exit 1
}
```

## Phase 1 — SCAN

Two filesystem-walking scripts (`node`, no `bun` needed) write deterministic
JSON for the rest of the pipeline. **Use `$SKILL_DIR` from Phase 0** — never
hardcode `${CLAUDE_PLUGIN_ROOT}` here:

```bash
node "$SKILL_DIR/scripts/scan-target.mjs"   --root "$TARGET"
node "$SKILL_DIR/scripts/extract-routes.mjs" --root "$TARGET"
```

These write `scan-result.json` and `boundary-surfaces.json` under
`$TARGET/.anydemo/intermediate/`.

Then POST the scan result to the studio to get ranked entry-point candidates:

```bash
curl -fsS -X POST "$STUDIO_URL/api/diagram/propose-scope" \
  -H 'content-type: application/json' \
  -d "$(jq '{files}' "$TARGET/.anydemo/intermediate/scan-result.json")" \
  > "$TARGET/.anydemo/intermediate/entry-candidates.json"
```

Then dispatch the **target-scanner** subagent (see
`$SKILL_DIR/agents/target-scanner.md`). It reads the JSON outputs,
produces a one-paragraph project summary, and lists detected diagrammable
subsystems. Output: `intermediate/project-summary.json`.

The agent is FORBIDDEN from re-reading source files; it summarizes the
deterministic output only.

## Phase 2 — SCOPE PROPOSAL

Dispatch the **scope-proposer** subagent. It reads:

- `intermediate/project-summary.json`
- `intermediate/scan-result.json`
- `intermediate/entry-candidates.json`
- The free-text request from `$ARGUMENTS`

…and writes `intermediate/scope-proposal.json` with `{ title, framing,
candidatePaths, estimatedNodeCount, questionsForUser[] }`.

### CHECKPOINT 1

Use `AskUserQuestion` to present the proposed scope. Options:

- **Approve** — proceed to Phase 3.
- **Expand** — widen scope (re-run scope-proposer with hint).
- **Contract** — narrow the slice generally (re-run scope-proposer
  with hint).
- **Split** — break into multiple demos along the lines the
  scope-proposer recommended in `sizeRecommendation.splits[]`. Each
  split re-enters the pipeline from Phase 2 with its own scope; the
  registered demos cross-link via `shapeNode` placeholders.
- **Merge** — collapse the sibling actions named in
  `sizeRecommendation.mergeGroups[]` into one `playNode` each whose
  `detail.description` spells out the internal steps. Re-run
  scope-proposer with the merge hint.
- **Promote to shape** — fold the supporting subsystem(s) named in
  `sizeRecommendation.promoteClusters[]` into a single decorative
  `shapeNode` / `stateNode`. Re-run scope-proposer with the hint.
- **Narrow** — drop the subsystem(s) named in
  `sizeRecommendation.narrowedAway[]`. Re-run scope-proposer with
  the hint.
- **Redirect** — let the user rewrite the framing entirely.

When `sizeRecommendation` is present, **surface the option whose name
matches `sizeRecommendation.kind` FIRST** (so `kind: "split"` puts
Split at the top, `kind: "promote-to-shape"` puts Promote to shape at
the top, …). When `sizeRecommendation` is null or omitted, hide the
four right-sizing options and show only Approve / Expand / Contract /
Redirect.

If `--scope=<name>` was passed, skip the checkpoint entirely.

## Phase 3 — TIER DETECTION

Dispatch the **tier-detector** subagent. It reads the runnability signals
from `scan-result.json` and may run targeted reads (`Makefile`, `Dockerfile`,
`package.json` `scripts`). Output: `intermediate/tier-evidence.json` with
`{ tier1RealEvidence, tier2MockEvidence, tier3StaticAlwaysFeasible,
recommendation }`.

### CHECKPOINT 2

Use `AskUserQuestion` to present the three tiers with evidence. The user picks
one. The recommendation is a *hint*, not a default.

If `--tier=` was passed, skip the checkpoint and stamp `chosenTier` directly
into `tier-evidence.json`.

## Phase 4 — NODE SELECTION

Dispatch the **node-selector** subagent (see `agents/node-selector.md`).
Hard constraints from the prompt:

- ≤30 total nodes
- Every node must classify into exactly one of: `dynamic-play`,
  `dynamic-event`, `static-state`, `static-shape`
- Tier 1 / Tier 2: at least one `dynamic-play` node
- Long tail folds into one or two `static-shape` nodes labeled
  "3rd-party SDKs" / "Internal admin tools"

Output: `intermediate/candidate-nodes.json`.

### CHECKPOINT 3

Use `AskUserQuestion` to show the proposed node list. Options:
- **Approve** — proceed to Phase 5
- **Add nodes** — append candidates and re-run node-selector
- **Remove nodes** — strip and re-run
- **Promote/demote** — change a node's category

## Phase 5 — WIRING

Dispatch the **wiring-builder** subagent. It produces a full `nodes[]` and
`connectors[]` array conforming to the studio's demo schema. The schema is
authoritative inside the studio — the `/api/demos/validate` endpoint will
reject anything that doesn't conform.

Constraints baked into the prompt:

- **`wiring-plan.json` MUST include a top-level `"name": "<diagram title>"`
  field.** The studio's `/api/diagram/assemble` endpoint falls back to
  `"Untitled diagram"` when this is missing — visible in the studio sidebar
  and in the registered slug. Use the title from the approved scope.
- `playNode` for `dynamic-play` (real URL on Tier 1; harness URL on Tier 2;
  demoted to `stateNode` on Tier 3)
- `stateNode` for `dynamic-event` with `stateSource: { kind: 'event' }`
- `shapeNode` for `static-shape`
- `stateNode` (no `playAction`, `stateSource: { kind: 'request' }`) for
  `static-state`
- Connector `kind` chosen by evidence: `http` / `event` / `queue` / `default`
- Every node populates `data.detail.summary` (1–2 sentences) and 0–4
  `data.detail.fields` from real evidence
- Apply the **Visual clarity for humans** rules below — favor duplicated
  fan-in nodes over spaghetti connections.

Output: `intermediate/wiring-plan.json`.

### Phase 5b (Tier 2 only) — HARNESS

If the chosen tier is `mock`, also dispatch **harness-author** (see
`agents/harness-author.md`). It writes:

- `$TARGET/.anydemo/harness/server.ts`
- `$TARGET/.anydemo/harness/package.json`
- `$TARGET/.anydemo/harness/README.md`

Templates live in `templates/`:
- `harness-server.ts.tmpl`
- `harness-package.json.tmpl`
- `harness-readme.md.tmpl`

Token replacements: `__DEMO_NAME__`, `__DEMO_SLUG__`, `__DEMO_ID__`,
`__HARNESS_PORT__`, `__ROUTE_HANDLERS__`.

The harness ONLY stubs routes the diagram references. The agent prompt
forbids inventing routes.

## Phase 6 — LAYOUT

Dispatch the **layout-arranger** subagent. It assigns `position: { x, y }`
to every node using lifecycle-role lanes:

- Actors → far left
- Entry points → left-center
- Services → center
- Workers / async → right
- Data stores → far right

The agent emits `intermediate/layout.json`.

## Phase 7 — ASSEMBLE & VALIDATE

Assemble the wiring + layout into a final demo via the studio. The endpoint
returns the assembled demo (IDs normalized, dupes dropped, dangling
connectors removed, positions snapped to a 24px grid).

The `layout.json` from Phase 6 is consumed as a **hint, not a contract** —
`/api/diagram/assemble` re-runs the canvas's "Tidy layout" algorithm
(dagre, left-to-right, with `nodesep: 60` / `ranksep: 140` so connectors
have room for labels) over the wiring graph. This guarantees the registered
diagram never overlaps, and pressing the canvas's Tidy button on a
freshly-registered demo is a no-op. Phase 6 still matters: the
layout-arranger's coarse y-bands feed dagre's barycenter ordering so the
final result still respects the lifecycle-lane intent (Actors above,
Workers below…), but exact x/y from Phase 6 are overwritten.

The skill writes the result to disk:

```bash
ASSEMBLE_BODY="$(jq -nc \
  --slurpfile w "$TARGET/.anydemo/intermediate/wiring-plan.json" \
  --slurpfile l "$TARGET/.anydemo/intermediate/layout.json" \
  '{wiring: $w[0], layout: $l[0]}')"
curl -fsS -X POST "$STUDIO_URL/api/diagram/assemble" \
  -H 'content-type: application/json' \
  -d "$ASSEMBLE_BODY" \
  | jq '.demo' > "$TARGET/.anydemo/demo.json"
```

Then validate via the studio. The endpoint runs schema, the ≤30-node cap,
and tier playability. `ok: false` means there are blocking issues; `ok: true`
with non-empty `warnings` is still a pass.

```bash
TIER="$(jq -r '.chosenTier // .recommendation // "static"' \
  "$TARGET/.anydemo/intermediate/tier-evidence.json")"
VALIDATE_BODY="$(jq -nc \
  --slurpfile d "$TARGET/.anydemo/demo.json" \
  --arg tier "$TIER" \
  '{demo: $d[0], tier: $tier}')"
VALIDATE_RESPONSE="$(curl -fsS -X POST "$STUDIO_URL/api/demos/validate" \
  -H 'content-type: application/json' \
  -d "$VALIDATE_BODY")"
echo "$VALIDATE_RESPONSE" > "$TARGET/.anydemo/intermediate/validation-report.json"
test "$(printf '%s' "$VALIDATE_RESPONSE" | jq -r .ok)" = "true"
```

**Tier 2 additional check (filesystem-local — studio can't see it):** when
tier=mock, confirm every `playAction.url` in the demo is handled by the
generated harness:

```bash
if [ "$TIER" = "mock" ] && [ ! -f "$TARGET/.anydemo/harness/server.ts" ]; then
  echo "Tier=mock but harness server.ts missing." >&2; exit 1
fi
```

If validation fails, return to Phase 5 with the validation report in context.
**Maximum 2 retries** — if still failing, surface the issues to the user.

## Phase 8 — REGISTER

Register the demo with the running studio:

```bash
DEMO_NAME="$(jq -r .name "$TARGET/.anydemo/demo.json")"
REGISTER_RESPONSE="$(curl -fsS -X POST "$STUDIO_URL/api/demos/register" \
  -H 'content-type: application/json' \
  -d "$(jq -nc \
    --arg name "$DEMO_NAME" \
    --arg repoPath "$TARGET" \
    --arg demoPath ".anydemo/demo.json" \
    '{name: $name, repoPath: $repoPath, demoPath: $demoPath}')")"
SLUG="$(printf '%s' "$REGISTER_RESPONSE" | jq -r .slug)"
DEMO_URL="$STUDIO_URL/d/$SLUG"
echo "Registered \"$DEMO_NAME\" → $DEMO_URL"
```

Then open the canvas in the user's browser. Prefer the platform-native opener
so the user lands on the deep-link slug page directly (the studio root has
known stale-bundle issues — see troubleshooting):

```bash
if command -v open >/dev/null 2>&1; then
  open "$DEMO_URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$DEMO_URL" >/dev/null 2>&1 &
else
  echo "Open $DEMO_URL in your browser to view the diagram."
fi
```

The studio re-validates the demo, upserts the registry entry, and writes
`.anydemo/sdk/emit.ts` if the demo declares any event-bound state node.
The user lands on the canvas at `<STUDIO_URL>/d/<slug>`.

If the chosen tier is `mock`, also print the harness run command:

> Mock harness ready. Run `cd .anydemo/harness && bun install && bun run start`
> to play the diagram.

### If the canvas appears blank

The studio is a React SPA — the most common cause is a stale JS bundle. See
**`references/troubleshooting.md`** "If the canvas appears blank" for the
exact four-step user instruction to relay.

## Determinism boundary

| Concern | Where | Why |
|---|---|---|
| File discovery, framework detection | `scripts/scan-target.mjs` (local Node) | LLM hallucinates paths |
| Route extraction | `scripts/extract-routes.mjs` (local Node) | regex is reliable per framework |
| Entry-point scoring | `POST /api/diagram/propose-scope` | deterministic heuristic |
| ID normalization, dedup, dangling cleanup | `POST /api/diagram/assemble` | LLM not trustworthy at scale |
| Final node positions (dagre Tidy layout) | `POST /api/diagram/assemble` | shares the algorithm behind the canvas's Tidy button so the registered diagram matches what the user gets if they press Tidy |
| Schema validation, cap, tier playability | `POST /api/demos/validate` | studio owns the schema |
| Subsystem summary, scope framing | `target-scanner` / `scope-proposer` | semantic |
| Tier feasibility | `tier-detector` | grading evidence |
| Connector `kind` inference | `wiring-builder` | semantic mapping |

## Failure & recovery

- `.anydemo/intermediate/` is **preserved on failure** so the next run can
  resume. Cleaned only on successful completion.
- Validation failure (`/api/demos/validate` returns `ok: false`) → return to
  Phase 5 (re-wire) with the report.
- Schema drift is impossible: the validator runs inside the studio, so it
  always uses the schema the studio enforces.

## Common pitfalls

See **`references/troubleshooting.md`** for a lookup table mapping every
common failure (studio not reachable, "Untitled diagram", spaghetti edges,
schema rejection, missing harness, …) to a one-line fix.

## Additional Resources

Paths below are relative to `$SKILL_DIR` (see the "Path convention" note
near the top of this file).

### Reference Files

For detailed information loaded only when needed:

- **`references/demo-schema.md`** — Authoritative demo schema: every
  node/connector variant, the canonical example, common rejection causes.
  Read before any Phase 5/6/7 emission.
- **`references/visual-clarity.md`** — Full rule set for duplicating
  cross-cutting nodes, with worked examples and per-phase enforcement
  notes. Read before producing wiring or layout.
- **`references/abstraction-level.md`** — Full catalogue of
  self-contained subsystems to collapse into one node (workflow
  engines, serverless, transactions, middleware chains, ETL, state
  machines, caching, service mesh, MCP/gRPC) with DO/DON'T pairs
  and the "when to expand internals" criteria. Read during Phase 4
  whenever the candidate list has multiple nodes from inside a
  single subsystem.
- **`references/trigger-bridges.md`** — Tier 2 bridge patterns for
  non-HTTP projects: Docker/Compose/K8s, file-driven ETL, queue/event/
  gRPC, libraries/CLIs/MCP/LSP, plus polyglot helper-script conventions
  when the harness needs a same-language runner inside the target. Read
  before grading Tier 2 feasibility (Phase 3) or authoring the harness
  (Phase 5b).
- **`references/troubleshooting.md`** — Lookup table mapping every common
  failure to its one-line fix. Surface lines from this when an HTTP call
  returns non-2xx or the canvas appears blank.

### Bundled Assets

- **`scripts/`** — `scan-target.mjs`, `extract-routes.mjs`. Run via
  `node` (see Phase 1).
- **`templates/`** — Tier-2 harness templates:
  `harness-server.ts.tmpl`, `harness-package.json.tmpl`,
  `harness-readme.md.tmpl`. Consumed by `harness-author`.
- **`frameworks/`** — Per-framework hints (`express.md`, `hono.md`,
  `nestjs.md`, `fastapi.md`, `django.md`, `rails.md`). Read the matching
  hint when the scan reports that framework.

### Subagents

Phase orchestration uses these subagent definitions under `agents/`:
`target-scanner.md` (Phase 1), `scope-proposer.md`
(Phase 2), `tier-detector.md` (Phase 3), `node-selector.md` (Phase 4),
`wiring-builder.md` (Phase 5), `harness-author.md` (Phase 5b, Tier 2 only),
`layout-arranger.md` (Phase 6).

In a Claude Code plugin install these same files are also exposed at the
plugin root (`$PLUGIN_ROOT/agents/`) so the harness picks them up as
auto-dispatchable subagents.

## Self-check before exit

Before reporting success, verify:

- [ ] `$TARGET/.anydemo/demo.json` exists
- [ ] `/api/demos/validate` returned `ok: true`
- [ ] `/api/demos/register` returned a slug
- [ ] `open $DEMO_URL` (or `xdg-open` on Linux) was invoked so the user's
      browser landed on the canvas without manual copy/paste
- [ ] On Tier 2: `$TARGET/.anydemo/harness/server.ts` exists with handlers
      for every URL referenced in the diagram
- [ ] On Tier 1: warned the user about any `playAction.url` that may be
      unreachable
