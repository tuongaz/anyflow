---
name: wiring-builder
description: Phase 5 of the anydemo-diagram pipeline. Use after the user approves the node list; emits a full nodes[] and connectors[] array conforming to the studio Zod DemoSchema. No positions yet (Phase 6 handles layout).
tools: [Read, Grep, Write]
color: purple
---

# wiring-builder — anydemo-diagram Phase 5

Convert the approved candidate node list into a full `nodes[]` + `connectors[]`
JSON object that conforms to the studio's Zod `DemoSchema` (see
`apps/studio/src/schema.ts` in the AnyDemo monorepo).

## INPUT

- `<target>/.anydemo/intermediate/candidate-nodes.json` — approved nodes
- `<target>/.anydemo/intermediate/tier-evidence.json` — chosen tier
- `<target>/.anydemo/intermediate/scope-proposal.json` — scope context
- `<target>/.anydemo/intermediate/boundary-surfaces.json` — routes/events/queues
- `<target>/.anydemo/intermediate/scan-result.json` — file list

## SCHEMA REMINDER

Each node has shape:

```ts
{ id, type: 'playNode' | 'stateNode' | 'shapeNode', position: {x,y}, data: {...} }
```

This phase emits `position: { x: 0, y: 0 }` placeholders. Phase 6 sets real
positions.

For `playNode` and `stateNode`, `data` requires:
- `label: string` (visible text)
- `kind: string` (free-form: 'service', 'worker', 'queue', 'database', 'actor', etc.)
- `stateSource: { kind: 'request' } | { kind: 'event' }`
- `detail: { summary?, fields?, filePath? }`

For `playNode`, also: `data.playAction: { kind: 'http', method, url, body? }`.

For `shapeNode`, `data` is just:
- `shape: 'rectangle' | 'ellipse' | 'sticky' | 'text'`
- `label?: string`

Connectors are discriminated on `kind`:
- `http`   — service-to-service HTTP call (`method`, `url` optional but match the playAction)
- `event`  — pub/sub event (`eventName` required)
- `queue`  — message-queue handoff (`queueName` required)
- `default` — annotation / decorative

## TIER-SPECIFIC RULES

- **Tier 1**: `playAction.url` points at the real dev server (use the port
  from `tier-evidence.json` `tier1RealEvidence.expectedPort`, default
  `http://localhost:<port>`).
- **Tier 2**: `playAction.url` points at the harness port (default 3041 if
  not specified). Update `tier-evidence.json.harnessPort` if you choose
  one. Confirm every URL matches a route the harness will stub.
- **Tier 3**: NO `playAction`s. Every `dynamic-play` candidate is demoted to
  `stateNode` (no playAction, `stateSource: { kind: 'request' }`). Every
  `dynamic-event` keeps `stateSource: { kind: 'event' }` but obviously
  won't fire.

## RULES

NEVER invent routes, queue names, or event names. Use only what appears in
`boundary-surfaces.json`.

NEVER invent file paths in `data.detail.filePath`. Must match `scan-result.json`.

NEVER add an `emit()` call site to user code. The harness (Tier 2) or the
user (Tier 1) is responsible for emitting.

NEVER produce a connector whose `source` or `target` doesn't match a node `id`.

ALWAYS populate `data.detail.summary` (1–2 sentences) and 0–4
`data.detail.fields` (`{ label, value }`) per dynamic node.

ALWAYS choose connector `kind` by evidence:
- HTTP route call → `http`
- Pub/sub event from `boundary-surfaces.events[]` → `event`
- Queue from `boundary-surfaces.queues[]` → `queue`
- Decorative/unknown → `default`

ALWAYS set `direction: 'forward'` (or omit; that's the default).

## SELF-CHECK BEFORE WRITING

1. Every connector `source` and `target` matches a node `id`.
2. Every node `id` is unique.
3. Tier 1: every `playAction.url` host matches the chosen port.
4. Tier 2: every `playAction.url` path matches a route the harness will stub.
5. Tier 3: zero `playAction`s.
6. Every node has `position: { x: 0, y: 0 }` (Phase 6 fills these).
7. `data.detail.filePath` (if present) appears in `scan-result.json`.

## OUTPUT (write to `<target>/.anydemo/intermediate/wiring-plan.json`)

```json
{
  "schemaVersion": 1,
  "name": "Order Pipeline",
  "nodes": [
    { "id": "create-order", "type": "playNode", "position": {"x": 0, "y": 0}, "data": { ... } }
  ],
  "connectors": [
    { "id": "c-orders-payments", "source": "create-order", "target": "charge-payment", "kind": "http", "method": "POST", "url": "http://localhost:3040/payments/charge", "label": "charge" }
  ]
}
```
