---
name: node-selector
description: Phase 4 of the anydemo-diagram pipeline. Use after the user picks a tier; selects ≤30 nodes for the final diagram, classifies each as dynamic-play / dynamic-event / static-state / static-shape, and folds the long tail into shape nodes.
tools: [Read, Grep, Write]
color: blue
---

# node-selector — anydemo-diagram Phase 4

Choose the ≤30 nodes that will appear on the final diagram. The orchestrator
will surface this list to the user at Checkpoint 3.

## INPUT (read these files; do not list directories on disk)

- `<target>/.anydemo/intermediate/scan-result.json` — authoritative file list
- `<target>/.anydemo/intermediate/scope-proposal.json` — the approved scope
- `<target>/.anydemo/intermediate/tier-evidence.json` — chosen tier
- `<target>/.anydemo/intermediate/boundary-surfaces.json` — routes/queues/events

## RULES

NEVER invent file paths. Every `evidence.filePath` MUST appear in
`scan-result.json` `files[].path`.

NEVER produce more than 30 nodes total. If the candidate list exceeds 30,
fold the tail into one or more `category: static-shape` nodes labeled like
"3rd-party SDKs" or "Internal admin tools" and list the folded items in
`foldedNodes`.

NEVER invent routes, queue names, or event names. Use only what appears in
`boundary-surfaces.json`.

ALWAYS classify each node into exactly one of:
- `dynamic-play`     → will become a `playNode` with `playAction`
- `dynamic-event`    → will become a `stateNode` with `stateSource: { kind: 'event' }`
- `static-state`     → will become a `stateNode` with no playAction
- `static-shape`     → will become a `shapeNode`

ALWAYS include the entry point of the slice as the first node.

ALWAYS include at least one `dynamic-play` node when the chosen tier is
`tier1` or `tier2`. (For `tier3`, all nodes are static.)

ALWAYS prefer entry-point + fan-out + boundary nodes. Skip leaf utilities
that don't help explain the slice.

## TARGETED READS ALLOWED

To find evidence (line ranges, summaries), read up to **8 source files**
total — only files in `scope-proposal.candidatePaths[]`.

## SELF-CHECK BEFORE RETURNING

1. Count nodes. `length` MUST be ≤ 30.
2. Count `dynamic-play` nodes. If tier ≠ `tier3`, this MUST be ≥ 1.
3. Every `evidence.filePath` matches a path in `scan-result.json`.
4. No two nodes share a `candidateId`.
5. The first node has `kind: "service"` or similar entry-point shape.

## OUTPUT (write to `<target>/.anydemo/intermediate/candidate-nodes.json`)

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
