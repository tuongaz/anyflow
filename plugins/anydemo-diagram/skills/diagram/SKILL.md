---
name: anydemo-diagram
description: This skill should be used when the user asks to "show me the architecture", "diagram this codebase", "explain how X works", "make a playable diagram", "generate an anydemo", "show me the order pipeline", "diagram the auth flow", or any request to produce a single flat playable architecture diagram for the AnyDemo studio. Drives a 6-phase pipeline (scan → scope → tier → nodes → wiring → layout → register) with three user checkpoints.
version: 0.1.0
argument-hint: "[free-text request] [--scope=<name>] [--tier=real|mock|static]"
---

# AnyDemo Diagram Generator

Generate a single flat playable AnyDemo diagram (`<target>/.anydemo/demo.json`)
from any codebase. The output is schema-valid against the studio's Zod
`DemoSchema`, has ≤30 nodes, and registers with the running studio so the
user can click the result.

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
Phase 1  SCAN           scan-target.mjs + extract-routes.mjs + propose-scope.mjs
                        → target-scanner agent for semantic summary
Phase 2  SCOPE          scope-proposer agent
                        ── CHECKPOINT 1 (AskUserQuestion: approve/refine scope)
Phase 3  TIER           tier-detector agent
                        ── CHECKPOINT 2 (AskUserQuestion: pick tier)
Phase 4  NODE SELECTION node-selector agent (≤30 nodes; folds long tail)
                        ── CHECKPOINT 3 (AskUserQuestion: confirm node list)
Phase 5  WIRING         wiring-builder agent (+ harness-author if Tier 2)
Phase 6  LAYOUT         layout-arranger agent
Phase 7  ASSEMBLE       assemble-demo.mjs + validate-demo.mjs
Phase 8  REGISTER       anydemo register --path <target>
```

Each agent reads a small set of intermediate JSON files and writes one back.
The orchestrator (this file) coordinates the phases and surfaces checkpoints.

## Phase 0 — Pre-flight

Resolve the target root and prepare directories:

```bash
TARGET="${TARGET:-$(pwd)}"
mkdir -p "$TARGET/.anydemo/intermediate"
```

Verify the AnyDemo monorepo has a built SDK if registering will write
`emit.ts`. The `anydemo register` CLI handles this; no action needed here.

## Phase 1 — SCAN

Run the deterministic scripts in order:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/skills/diagram/scripts/scan-target.mjs --root "$TARGET"
bun ${CLAUDE_PLUGIN_ROOT}/skills/diagram/scripts/extract-routes.mjs --root "$TARGET"
bun ${CLAUDE_PLUGIN_ROOT}/skills/diagram/scripts/propose-scope.mjs --root "$TARGET"
```

These write `scan-result.json`, `boundary-surfaces.json`, and
`entry-candidates.json` under `$TARGET/.anydemo/intermediate/`.

Then dispatch the **target-scanner** subagent (see `agents/target-scanner.md`).
It reads the JSON outputs, produces a one-paragraph project summary, and
lists detected diagrammable subsystems. Output:
`intermediate/project-summary.json`.

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
`connectors[]` array conforming to the studio Zod schema (see
`apps/studio/src/schema.ts` for the source of truth).

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

Run the deterministic pipeline:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/skills/diagram/scripts/assemble-demo.mjs --root "$TARGET"
bun ${CLAUDE_PLUGIN_ROOT}/skills/diagram/scripts/validate-demo.mjs --root "$TARGET"
```

`assemble-demo.mjs` concatenates wiring + layout, normalizes IDs, dedupes,
drops dangling connectors, snaps to a 24px grid. Writes `$TARGET/.anydemo/demo.json`.

`validate-demo.mjs` runs the demo through the studio's Zod `DemoSchema`
plus skill-specific checks (≤30 nodes, tier consistency, harness coverage,
event emitter presence). Exits non-zero on issues.

If validation fails, return to Phase 5 with the validation report in context.
**Maximum 2 retries** — if still failing, surface the issues to the user.

## Phase 8 — REGISTER

Run the existing CLI:

```bash
anydemo register --path "$TARGET"
```

This re-validates and POSTs to the running studio. If the studio is not
running, the CLI starts it in the background. The user lands on the canvas
at `http://localhost:4321/d/<slug>`.

If the chosen tier is `mock`, also print the harness run command:

> Mock harness ready. Run `cd .anydemo/harness && bun install && bun run start`
> to play the diagram.

## Determinism boundary

| Concern | Where | Why |
|---|---|---|
| File discovery, framework detection | `scripts/scan-target.mjs` | LLM hallucinates paths |
| Route extraction | `scripts/extract-routes.mjs` | regex is reliable per framework |
| Schema validation | `scripts/validate-demo.mjs` (Zod re-import) | one source of truth |
| ID normalization, dedup, dangling cleanup | `scripts/assemble-demo.mjs` | LLM not trustworthy at scale |
| Position snapping & overlap | `scripts/assemble-demo.mjs` | LLM gives plausible-but-overlapping positions |
| Subsystem summary, scope framing | `target-scanner` / `scope-proposer` | semantic |
| Tier feasibility | `tier-detector` | grading evidence |
| Connector `kind` inference | `wiring-builder` | semantic mapping |

## Failure & recovery

- `.anydemo/intermediate/` is **preserved on failure** so the next run can
  resume. Cleaned only on successful completion.
- Validation failure → return to Phase 5 (re-wire) with the report.
- Schema drift is impossible: the validator imports the studio schema directly.

## Additional resources

### Subagent files

All in `agents/` at the plugin root:
- `target-scanner.md` — Phase 1 LLM
- `scope-proposer.md` — Phase 2 LLM
- `tier-detector.md` — Phase 3 LLM
- `node-selector.md` — Phase 4 LLM
- `wiring-builder.md` — Phase 5 LLM
- `harness-author.md` — Phase 5b LLM (Tier 2 only)
- `layout-arranger.md` — Phase 6 LLM

### Per-framework hints

In `frameworks/`:
- `express.md`, `hono.md`, `nestjs.md`, `fastapi.md`, `django.md`, `rails.md`

Read the matching framework hint when the scan reports that framework. Each
hint covers route shape, port detection, event/queue idioms, and tier notes.

### Scripts

In `scripts/`:
- `scan-target.mjs`, `extract-routes.mjs`, `propose-scope.mjs`,
  `assemble-demo.mjs`, `validate-demo.mjs`

### Templates

In `templates/` (Tier 2 only):
- `harness-server.ts.tmpl`, `harness-package.json.tmpl`, `harness-readme.md.tmpl`

## Self-check before exit

Before reporting success, verify:

- [ ] `$TARGET/.anydemo/demo.json` exists
- [ ] `validate-demo.mjs` exited 0
- [ ] `anydemo register` returned a slug
- [ ] On Tier 2: `$TARGET/.anydemo/harness/server.ts` exists with handlers
      for every URL referenced in the diagram
- [ ] On Tier 1: warned the user about any `playAction.url` that may be
      unreachable
