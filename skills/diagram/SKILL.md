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
  `http://localhost:4321`). Probe `GET /health` to confirm.
- **Node.js** (any LTS) on `PATH` — the two filesystem scripts under
  `$PLUGIN_ROOT/skills/diagram/scripts/` run on Node. `$PLUGIN_ROOT` is
  resolved in Phase 0 (it falls back to `~/.claude/plugins/anydemo-diagram`
  when Claude Code does not export `CLAUDE_PLUGIN_ROOT`).
- `curl` and `jq` for the HTTP calls below.

All schema validation, scope scoring, demo assembly, and registration happen
**via the studio's HTTP API**. The skill ships two small Node scripts that
walk the user's `$TARGET` filesystem; everything else is a `curl` call.

## Announcement

Announce: "Using anydemo-diagram skill to generate a playable diagram for: <request>"

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

## Visual clarity for humans — duplicate to declutter

This skill produces diagrams **for humans to read**, not data graphs for
machines. A wiring with 30 nodes and 80 connectors that all converge on one
`db` box is correct but unreadable; the same diagram with the `db` *drawn
three times* near its three consumers is the goal.

The studio's schema allows — and the pipeline *encourages* — duplicating a
single logical resource into multiple node instances with distinct ids:

- Every node has a unique `id`, but `label`, `kind`, `playAction`, and
  `data.detail` can be repeated across duplicates. Two `stateNode`s both
  labeled "Orders DB" are valid; the studio's `/api/diagram/assemble` keeps
  them separate, and React Flow renders them as two boxes.
- Duplicates exist to **shorten arrows and keep lanes clean**. They are not
  for representing different state.

**When to duplicate (apply in Phases 4, 5, 6):**

1. **Fan-in ≥ 3.** Any node that would receive ≥3 incoming connectors must be
   split into one instance per cluster of callers.
2. **Cross-cutting infra.** Always duplicate `database`, `cache`, `auth`,
   `logging`, `metrics`, `error reporter`, and any primary queue per consumer
   group — even at 2 callers.
3. **Long-distance edges.** If a connector would cross more than one other
   connector to reach its target, duplicate the target instead of routing
   around the crossing.

**Id conventions for duplicates:** suffix with the consumer name —
`db-orders`, `db-payments`, `cache-checkout`, `auth-public`,
`auth-admin`. Keep `label` identical across the set so a reader recognizes
them as the same logical thing.

**What stays single:**

- The user-facing entry points (one `POST /orders`, not three).
- Domain-owning services (one `orders-service`, not three).
- Anything that genuinely is one box per logical thing.

Phases 4, 5, and 6 each enforce a slice of this:

- **Phase 4 (node-selector)** counts incoming fan-in and proposes duplicates.
- **Phase 5 (wiring-builder)** rejects any node with fan-in ≥3 in self-check.
- **Phase 6 (layout-arranger)** places duplicates next to their consumer, not
  in the original lane.

## Phase 0 — Pre-flight

Resolve the target root, the studio URL, **and the plugin root**, then prepare
directories. `CLAUDE_PLUGIN_ROOT` is only exported when the skill is invoked as
part of a Claude Code plugin — on direct `/diagram` usage or in a vendored
checkout it is empty, which is why this step has a fallback chain.

```bash
TARGET="${TARGET:-$(pwd)}"
STUDIO_URL="${ANYDEMO_STUDIO_URL:-http://localhost:4321}"

# Resolve plugin root — first the env var, then the standard install paths.
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
for candidate in \
  "$HOME/.claude/plugins/anydemo-diagram" \
  "$HOME/.claude/skills/anydemo-diagram" \
  "$(pwd)"; do
  [ -n "$PLUGIN_ROOT" ] && break
  [ -f "$candidate/skills/diagram/SKILL.md" ] && PLUGIN_ROOT="$candidate"
done
[ -n "$PLUGIN_ROOT" ] || { echo "Cannot locate anydemo-diagram plugin root." >&2; exit 1; }

mkdir -p "$TARGET/.anydemo/intermediate"

# Studio must be reachable — every non-filesystem step is an HTTP call.
curl -fsS --max-time 1 "$STUDIO_URL/health" >/dev/null \
  || { echo "AnyDemo studio not reachable at $STUDIO_URL. Start it with 'cd $PLUGIN_ROOT && bun run dev' (or pass ANYDEMO_STUDIO_URL=...) and re-run." >&2; exit 1; }
```

## Phase 1 — SCAN

Two filesystem-walking scripts (`node`, no `bun` needed) write deterministic
JSON for the rest of the pipeline. **Use `$PLUGIN_ROOT` from Phase 0** — never
hardcode `${CLAUDE_PLUGIN_ROOT}` here:

```bash
node "$PLUGIN_ROOT/skills/diagram/scripts/scan-target.mjs"   --root "$TARGET"
node "$PLUGIN_ROOT/skills/diagram/scripts/extract-routes.mjs" --root "$TARGET"
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
`$PLUGIN_ROOT/agents/target-scanner.md`). It reads the JSON outputs,
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

## Common pitfalls

See **`references/troubleshooting.md`** for a lookup table mapping every
common failure (studio not reachable, "Untitled diagram", spaghetti edges,
schema rejection, missing harness, …) to a one-line fix.

## Additional Resources

All paths below are relative to `$PLUGIN_ROOT` (resolved in Phase 0).

### Reference Files

For detailed information loaded only when needed:

- **`skills/diagram/references/demo-schema.md`** — Authoritative demo schema:
  every node/connector variant, the canonical example, common rejection
  causes. Read before any Phase 5/6/7 emission.
- **`skills/diagram/references/troubleshooting.md`** — Lookup table mapping
  every common failure to its one-line fix. Surface lines from this when an
  HTTP call returns non-2xx or the canvas appears blank.

### Bundled Assets

- **`skills/diagram/scripts/`** — `scan-target.mjs`, `extract-routes.mjs`.
  Run via `node` under `$PLUGIN_ROOT` (see Phase 1).
- **`skills/diagram/templates/`** — Tier-2 harness templates:
  `harness-server.ts.tmpl`, `harness-package.json.tmpl`,
  `harness-readme.md.tmpl`. Consumed by `harness-author`.
- **`skills/diagram/frameworks/`** — Per-framework hints (`express.md`,
  `hono.md`, `nestjs.md`, `fastapi.md`, `django.md`, `rails.md`). Read the
  matching hint when the scan reports that framework.

### Subagents

Phase orchestration uses these subagent definitions under `agents/`:
`target-scanner.md` (Phase 1), `scope-proposer.md` (Phase 2),
`tier-detector.md` (Phase 3), `node-selector.md` (Phase 4),
`wiring-builder.md` (Phase 5), `harness-author.md` (Phase 5b, Tier 2 only),
`layout-arranger.md` (Phase 6).

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
