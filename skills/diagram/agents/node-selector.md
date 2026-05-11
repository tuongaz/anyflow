---
name: node-selector
description: Phase 4 of the diagram pipeline. Use after the user picks a tier; selects ≤30 nodes for the final diagram, classifies each as dynamic-play / dynamic-event / static-state / static-shape, and folds the long tail into shape nodes.
tools: [Read, Grep, Write]
color: blue
---

# node-selector — diagram Phase 4

Choose the ≤30 nodes that will appear on the final diagram. The orchestrator
will surface this list to the user at Checkpoint 3.

## INPUT (read these files; do not list directories on disk)

`<slug>` is the per-demo folder the orchestrator passes in. All
intermediate JSON for this demo lives under
`<target>/.anydemo/<slug>/intermediate/`.

- `<target>/.anydemo/<slug>/intermediate/scan-result.json` — authoritative file list
- `<target>/.anydemo/<slug>/intermediate/scope-proposal.json` — the approved scope
- `<target>/.anydemo/<slug>/intermediate/tier-evidence.json` — chosen tier
- `<target>/.anydemo/<slug>/intermediate/boundary-surfaces.json` — routes/queues/events

## RULES

NEVER invent file paths. Every `evidence.filePath` MUST appear in
`scan-result.json` `files[].path`.

NEVER produce more than 30 nodes total. If the candidate list exceeds 30,
fold the tail into one or more `category: static-shape` nodes labeled like
"3rd-party SDKs" or "Internal admin tools" and list the folded items in
`foldedNodes`.

NEVER invent routes, queue names, or event names. Use only what appears in
`boundary-surfaces.json`.

NEVER decompose a self-contained subsystem into its internal steps.
Each Temporal/Step-Functions/Inngest workflow, Lambda handler, DB
transaction, middleware chain, ETL CLI invocation, React component
tree, state machine, or caching mechanism is ONE node unless (a) the
user's framing explicitly asks for its internals, (b) multiple
internals are independently triggerable (each becomes its own
`playNode`), or (c) the internals span distinct owners. Push internal
detail into `data.detail.description` / `data.detail.fields`, not into
extra nodes. **Apply the "next adjacent node" test**: if the next
candidate belongs to the same owner, runtime, AND network hop as the
current one, do NOT add it — fold it into the parent. See "Pick the
right abstraction — hide internals, show seams" in `SKILL.md` and
the full catalogue in `references/abstraction-level.md`.

ALWAYS classify each node into exactly one of:
- `dynamic-play`     → will become a `playNode` with `playAction`
- `dynamic-event`    → will become a `stateNode` with `stateSource: { kind: 'event' }`
- `static-state`     → will become a `stateNode` with no playAction
- `static-shape`     → will become a `shapeNode`

ALWAYS include the entry point of the slice as the first node.

ALWAYS include at least one `dynamic-play` node when the chosen tier is
`tier1` or `tier2`. (For `tier3`, all nodes are static.)

ALWAYS pair every `dynamic-play` (trigger) with a downstream
`dynamic-event` (observer) when the trigger has an observable
consequence — a DB write, an S3 upload, a queue publish, an event
emission, a job completion, a webhook fire. The observer is the
`stateNode` that animates from spinner to green tick as the harness
emits `running` → `done` against it. See "Two flavors of runnable
node — triggers and observers" in `SKILL.md`. Skip the observer only
when the trigger is purely synchronous and returns the result inline,
OR when the downstream resource is already drawn elsewhere as a
duplicated cross-cutting node. **A diagram with only triggers and no
observers wastes the canvas's strongest affordance** — readers don't
see the consequences animate.

ALWAYS prefer entry-point + fan-out + boundary nodes. Skip leaf utilities
that don't help explain the slice.

ALWAYS estimate fan-in for each cross-cutting resource (database, cache,
auth, logging, metrics, queue). If a single logical resource will receive
≥3 incoming connectors in the wired diagram, **emit one candidate node per
consumer cluster** instead of one merged node. Each duplicate counts toward
the ≤30 cap. Give each duplicate a distinct `candidateId` (`db-orders`,
`db-payments`) but keep `label` identical so wiring-builder and the reader
recognize them as the same logical thing. The rationale should say
"duplicate of <logical-name> for visual clarity, used by <consumer>".

This is the "Visual clarity for humans" rule from `SKILL.md` — read
`references/visual-clarity.md` for the full rule set before proposing
nodes.

## TARGETED READS ALLOWED

To find evidence (line ranges, summaries), read up to **8 source files**
total — only files in `scope-proposal.candidatePaths[]`.

## SELF-CHECK BEFORE RETURNING

1. Count nodes. `length` MUST be ≤ 30.
2. Count `dynamic-play` nodes. If tier ≠ `tier3`, this MUST be ≥ 1.
3. For each `dynamic-play` whose work has an observable consequence
   (DB write, S3 upload, queue publish, event emission, job completion,
   webhook fire), there is a downstream `dynamic-event` observer
   candidate OR a written rationale on the trigger explaining why the
   trigger is synchronous-only (e.g. `"rationale": "Returns the
   computed total inline — no async side effect"`).
4. Every `evidence.filePath` matches a path in `scan-result.json`.
5. No two nodes share a `candidateId`.
6. The first node has `kind: "service"` or similar entry-point shape.
7. No single logical resource (same `label`) sits with implied fan-in ≥3 in
   the chosen scope. If it would, replace it with duplicates (`candidateId`
   suffixed per consumer, `label` identical).
8. No node represents an internal step of a self-contained subsystem
   already covered by another node — apply the "next adjacent node"
   test for each candidate (same owner + runtime + network hop as a
   neighbor → fold, do not add).

## OUTPUT (write to `<target>/.anydemo/<slug>/intermediate/candidate-nodes.json`)

```json
{
  "schemaVersion": 1,
  "nodes": [
    {
      "candidateId": "create-order",
      "kind": "service",
      "category": "dynamic-play",
      "label": "POST /orders",
      "rationale": "Entry point of the slice; HTTP POST handler",
      "evidence": {
        "filePath": "src/server.ts",
        "lineRange": [42, 78],
        "method": "POST",
        "route": "/orders"
      }
    }
  ],
  "exceededCap": false,
  "foldedNodes": []
}
```
