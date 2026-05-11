---
name: anydemo-diagram
description: This skill should be used when the user asks to "show me the architecture", "diagram this codebase", "explain how X works", "make a playable diagram", "generate an anydemo", "show me the order pipeline", "diagram the auth flow", or any request to produce a single flat playable architecture diagram for the AnyDemo studio. Drives a 6-phase pipeline (scan → scope → tier → nodes → wiring → layout → register) with three user checkpoints.
version: 0.1.0
argument-hint: "[free-text request] [--scope=<name>] [--tier=real|mock|static]"
---

# AnyDemo Diagram Generator

Generate a single flat playable AnyDemo diagram (`<target>/.anydemo/demo.json`)
from any codebase. The output is schema-valid, has ≤30 nodes, and registers
with the running studio so the user can click the result.

## Requirements

- A running AnyDemo studio reachable at `$ANYDEMO_STUDIO_URL` (default
  `http://localhost:4321`). Probe `GET /health` if you need to confirm.
- **Node.js** (any LTS) on `PATH` — the two filesystem scripts in
  `${CLAUDE_PLUGIN_ROOT}/skills/diagram/scripts/` run under Node.
- `curl` and `jq` for the HTTP calls below.

All schema validation, scope scoring, demo assembly, and registration happen
**via the studio's HTTP API**. The skill ships two small Node scripts that
walk the user's `$TARGET` filesystem; everything else is a `curl` call.

## Announcement

Announce: "Using anydemo-diagram skill to generate a playable diagram for: <request>"

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

**The studio's `/api/demos/validate` and `/api/demos/register` endpoints reject
anything that doesn't match this schema exactly.** Every phase that emits JSON
nodes or connectors (Phase 5 wiring, Phase 6 layout, Phase 7 assemble) must
conform. Read this section before producing wiring.

### Top level

```ts
type Demo = {
  version: 1;                    // literal, never any other number
  name: string;                  // min length 1
  nodes: Node[];
  connectors: Connector[];
  resetAction?: HttpAction;      // optional declarative reset endpoint
};
```

### Node — discriminated union on `type`

Every node has `{ id, type, position, data }`. `id` is a non-empty string and
**must be unique** across `nodes[]`. `position` is `{ x: number, y: number }`.

```ts
type Node = PlayNode | StateNode | ShapeNode | ImageNode;
```

**PlayNode** — has a `playAction` (clickable, runs an HTTP call):

```ts
{
  id: string;
  type: 'playNode';
  position: { x: number; y: number };
  data: {
    label: string;               // min 1, the visible text
    kind: string;                 // free-form: 'service'|'worker'|'queue'|'database'|'actor'|...
    stateSource: { kind: 'request' } | { kind: 'event' };
    playAction: HttpAction;       // REQUIRED for playNode
    detail?: Detail;
    handlerModule?: string;       // reserved v2, leave unset
    // visual (all optional):
    width?: number; height?: number;
    borderColor?: ColorToken; backgroundColor?: ColorToken;
    borderSize?: number; borderStyle?: 'solid' | 'dashed' | 'dotted';
    fontSize?: number; cornerRadius?: number;
  };
}
```

**StateNode** — same data as PlayNode but `playAction` is **optional**:

```ts
{
  id: string;
  type: 'stateNode';
  position: { x: number; y: number };
  data: {
    label: string;
    kind: string;
    stateSource: { kind: 'request' } | { kind: 'event' };
    playAction?: HttpAction;      // optional
    detail?: Detail;
    handlerModule?: string;
    // visual fields (same as PlayNode)
  };
}
```

**ShapeNode** — decorative; no kind/stateSource/playAction:

```ts
{
  id: string;
  type: 'shapeNode';
  position: { x: number; y: number };
  data: {
    shape: 'rectangle' | 'ellipse' | 'sticky' | 'text';
    label?: string;
    // visual fields (same as PlayNode)
  };
}
```

**ImageNode** — decorative; embeds a base64 data URL:

```ts
{
  id: string;
  type: 'imageNode';
  position: { x: number; y: number };
  data: {
    image: string;                // MUST start with "data:image/"
    alt?: string;
    // visual fields (same as PlayNode)
  };
}
```

### Connector — discriminated union on `kind`

Every connector has the base fields below plus per-kind required fields.
**`source` and `target` MUST reference existing node `id`s** — the studio's
superRefine rejects dangling connectors.

```ts
type ConnectorBase = {
  id: string;                    // min 1, unique across connectors[]
  source: string;                // node id
  target: string;                // node id
  sourceHandle?: 'r' | 'b';      // source-side handles only (right / bottom)
  targetHandle?: 't' | 'l';      // target-side handles only (top / left)
  sourceHandleAutoPicked?: boolean;
  targetHandleAutoPicked?: boolean;
  label?: string;
  style?: 'solid' | 'dashed' | 'dotted';
  color?: ColorToken;
  direction?: 'forward' | 'backward' | 'both';   // default 'forward' when omitted
  borderSize?: number;
  path?: 'curve' | 'step';
};

type Connector =
  | (ConnectorBase & { kind: 'http';    method?: HttpMethod; url?: string })
  | (ConnectorBase & { kind: 'event';   eventName: string })   // REQUIRED
  | (ConnectorBase & { kind: 'queue';   queueName: string })   // REQUIRED
  | (ConnectorBase & { kind: 'default' });
```

**Handle-role rule:** sending a target-side id (`'t'` or `'l'`) as
`sourceHandle`, or a source-side id (`'r'` or `'b'`) as `targetHandle`, is a
schema violation (US-022). Omitting both is fine; React Flow auto-routes.

### Shared types

```ts
type HttpAction = {
  kind: 'http';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;                   // min 1
  body?: unknown;
  bodySchema?: unknown;
};

type Detail = {
  filePath?: string;
  summary?: string;
  fields?: Array<{ label: string; value: string }>;
  dynamicSource?: HttpAction;   // same shape as playAction; fetched lazily for the side-panel
};

type ColorToken =
  | 'default' | 'slate' | 'blue' | 'green'
  | 'amber'   | 'red'   | 'purple' | 'pink';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
```

### Canonical valid demo

```json
{
  "version": 1,
  "name": "Order Pipeline",
  "nodes": [
    {
      "id": "user",
      "type": "shapeNode",
      "position": { "x": 0, "y": 0 },
      "data": { "shape": "sticky", "label": "User" }
    },
    {
      "id": "api-create-order",
      "type": "playNode",
      "position": { "x": 240, "y": 0 },
      "data": {
        "label": "POST /orders",
        "kind": "service",
        "stateSource": { "kind": "request" },
        "playAction": {
          "kind": "http",
          "method": "POST",
          "url": "http://localhost:3040/orders",
          "body": { "sku": "abc", "qty": 1 }
        },
        "detail": {
          "filePath": "src/routes/orders.ts",
          "summary": "Creates an order row and emits orders.created.",
          "fields": [
            { "label": "Returns", "value": "{ orderId }" }
          ]
        }
      }
    },
    {
      "id": "queue-orders",
      "type": "stateNode",
      "position": { "x": 480, "y": 0 },
      "data": {
        "label": "orders.created",
        "kind": "queue",
        "stateSource": { "kind": "event" }
      }
    }
  ],
  "connectors": [
    {
      "id": "c-user-api",
      "source": "user",
      "target": "api-create-order",
      "kind": "default"
    },
    {
      "id": "c-api-queue",
      "source": "api-create-order",
      "target": "queue-orders",
      "kind": "event",
      "eventName": "orders.created"
    }
  ]
}
```

### Common rejection causes

- `version` not literal `1` → reject.
- Connector `source`/`target` doesn't match any node `id` → reject.
- `EventConnector` without `eventName` (or empty) → reject.
- `QueueConnector` without `queueName` → reject.
- `PlayNode` without `playAction` → reject.
- `imageNode.data.image` doesn't start with `data:image/` → reject.
- `sourceHandle: 't'` / `targetHandle: 'r'` (wrong role) → reject.
- Duplicate node ids or duplicate connector ids → undefined behavior; the
  studio's assemble endpoint dedupes, but author-side duplicates indicate a
  bug — keep ids unique.
- `name` empty string → reject.

## Phase 0 — Pre-flight

Resolve the target root and the studio URL, then prepare directories:

```bash
TARGET="${TARGET:-$(pwd)}"
STUDIO_URL="${ANYDEMO_STUDIO_URL:-http://localhost:4321}"
mkdir -p "$TARGET/.anydemo/intermediate"

# Studio must be reachable — every non-filesystem step is an HTTP call.
curl -fsS --max-time 1 "$STUDIO_URL/health" >/dev/null \
  || { echo "AnyDemo studio not reachable at $STUDIO_URL. Start it and re-run." >&2; exit 1; }
```

## Phase 1 — SCAN

Two filesystem-walking scripts (`node`, no `bun` needed) write deterministic
JSON for the rest of the pipeline:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/diagram/scripts/scan-target.mjs --root "$TARGET"
node ${CLAUDE_PLUGIN_ROOT}/skills/diagram/scripts/extract-routes.mjs --root "$TARGET"
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
`${CLAUDE_PLUGIN_ROOT}/agents/target-scanner.md`). It reads the JSON outputs,
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
- **Approve** — proceed to Phase 3
- **Expand** — widen scope (re-run scope-proposer with hint)
- **Contract** — narrow the slice (re-run scope-proposer with hint)
- **Redirect** — let the user rewrite the framing entirely

If `--scope=<name>` was passed, skip the checkpoint.

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

- `playNode` for `dynamic-play` (real URL on Tier 1; harness URL on Tier 2;
  demoted to `stateNode` on Tier 3)
- `stateNode` for `dynamic-event` with `stateSource: { kind: 'event' }`
- `shapeNode` for `static-shape`
- `stateNode` (no `playAction`, `stateSource: { kind: 'request' }`) for
  `static-state`
- Connector `kind` chosen by evidence: `http` / `event` / `queue` / `default`
- Every node populates `data.detail.summary` (1–2 sentences) and 0–4
  `data.detail.fields` from real evidence

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
connectors removed, positions snapped to a 24px grid). The skill writes the
result to disk:

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
echo "Registered \"$DEMO_NAME\" → $STUDIO_URL/d/$SLUG"
```

The studio re-validates the demo, upserts the registry entry, and writes
`.anydemo/sdk/emit.ts` if the demo declares any event-bound state node.
The user lands on the canvas at `<STUDIO_URL>/d/<slug>`.

If the chosen tier is `mock`, also print the harness run command:

> Mock harness ready. Run `cd .anydemo/harness && bun install && bun run start`
> to play the diagram.

## Determinism boundary

| Concern | Where | Why |
|---|---|---|
| File discovery, framework detection | `scripts/scan-target.mjs` (local Node) | LLM hallucinates paths |
| Route extraction | `scripts/extract-routes.mjs` (local Node) | regex is reliable per framework |
| Entry-point scoring | `POST /api/diagram/propose-scope` | deterministic heuristic |
| ID normalization, dedup, dangling cleanup | `POST /api/diagram/assemble` | LLM not trustworthy at scale |
| Position snapping & overlap | `POST /api/diagram/assemble` | LLM gives plausible-but-overlapping positions |
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

## Plugin-bundled resources

All paths below are relative to `${CLAUDE_PLUGIN_ROOT}`:

- **`agents/`** — subagent definitions referenced by phase: `target-scanner.md`,
  `scope-proposer.md`, `tier-detector.md`, `node-selector.md`,
  `wiring-builder.md`, `harness-author.md` (Tier 2 only), `layout-arranger.md`.
- **`frameworks/`** — per-framework hints (`express.md`, `hono.md`,
  `nestjs.md`, `fastapi.md`, `django.md`, `rails.md`). Read the matching hint
  when the scan reports that framework.
- **`skills/diagram/scripts/`** — `scan-target.mjs`, `extract-routes.mjs`.
- **`skills/diagram/templates/`** — Tier 2 harness templates:
  `harness-server.ts.tmpl`, `harness-package.json.tmpl`, `harness-readme.md.tmpl`.

## Self-check before exit

Before reporting success, verify:

- [ ] `$TARGET/.anydemo/demo.json` exists
- [ ] `/api/demos/validate` returned `ok: true`
- [ ] `/api/demos/register` returned a slug
- [ ] On Tier 2: `$TARGET/.anydemo/harness/server.ts` exists with handlers
      for every URL referenced in the diagram
- [ ] On Tier 1: warned the user about any `playAction.url` that may be
      unreachable
