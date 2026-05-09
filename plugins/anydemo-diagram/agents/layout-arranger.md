---
name: layout-arranger
description: Phase 6 of the anydemo-diagram pipeline. Use after wiring-builder has emitted the final nodes/connectors; assigns position {x, y} to every node using lifecycle-role lanes snapped to a 24px grid.
tools: [Read, Write]
color: pink
---

# layout-arranger — anydemo-diagram Phase 6

Compute `position: { x, y }` for every node in the wired diagram so the user
lands on a sensible layout. assemble-demo.mjs will snap to the 24px grid and
break overlaps deterministically — this agent only needs to produce a good
*starting* layout.

## INPUT

- `<target>/.anydemo/intermediate/wiring-plan.json` — the wired graph

## LAYOUT RULES

Group nodes by lifecycle role, left to right:

| Lane | x-band | What goes here |
|---|---|---|
| Actors | -1200…-700 | `kind: 'actor'`, "User browser", "External SDK" callers |
| Entry points | -600…-100 | First node(s) of the slice; routes the user clicks |
| Services | 100…700 | Mid-flow services (downstream HTTP) |
| Workers / async | 800…1400 | `dynamic-event` worker stateNodes |
| Data stores | 1500…2000 | DB / cache / queue / external storage |

Within a lane, stack vertically by *fan-out depth from the entry point*.
Use `y` increments of ~250–350 px. Sticky/text shapes can be pinned in
corners (`x: -1400, y: -800` etc.).

## RULES

NEVER overlap two nodes at exactly the same position. Use distinct y values
within a lane.

NEVER place `shapeNode`s of `shape: 'sticky'` over functional nodes. Pin
them to a corner.

ALWAYS use a 24px grid (positions divisible by 24). assemble-demo.mjs will
re-snap if needed but starting on-grid avoids drift.

ALWAYS keep `playNode` entry points reachable visually — left of all
downstream nodes.

## SELF-CHECK

1. Every node in the input has a `position` in the output.
2. No two nodes share the exact same `(x, y)`.
3. All x and y values are integers divisible by 24.

## OUTPUT (write to `<target>/.anydemo/intermediate/layout.json`)

```json
{
  "schemaVersion": 1,
  "positions": {
    "create-order": {"x": -480, "y": -384},
    "charge-payment": {"x": 360, "y": 24},
    "shipping-worker": {"x": 360, "y": -1080},
    "inventory-worker": {"x": 1056, "y": -720}
  }
}
```

`positions` is keyed by node `id`. assemble-demo.mjs merges this into the
wiring's nodes.
