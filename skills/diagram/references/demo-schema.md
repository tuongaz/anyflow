# Demo Schema Reference

The studio's `/api/demos/validate` and `/api/demos/register` endpoints reject
anything that doesn't match this schema exactly. Every phase of the
anydemo-diagram pipeline that emits JSON nodes or connectors (Phase 5 wiring,
Phase 6 layout, Phase 7 assemble) must conform.

Read this file before producing wiring.

## Top level

```ts
type Demo = {
  version: 1;                    // literal, never any other number
  name: string;                  // min length 1
  nodes: Node[];
  connectors: Connector[];
  resetAction?: HttpAction;      // optional declarative reset endpoint
};
```

## Node — discriminated union on `type`

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

## Connector — discriminated union on `kind`

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

## Shared types

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

## Canonical valid demo

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

## Common rejection causes

- `version` not literal `1` → reject.
- Connector `source`/`target` doesn't match any node `id` → reject.
- `EventConnector` without `eventName` (or empty) → reject.
- `QueueConnector` without `queueName` → reject.
- `PlayNode` without `playAction` → reject.
- `imageNode.data.image` doesn't start with `data:image/` → reject.
- `sourceHandle: 't'` / `targetHandle: 'r'` (wrong role) → reject.
- Duplicate node ids or duplicate connector ids → undefined behavior; the
  studio's assemble endpoint dedupes, but author-side duplicates indicate a
  bug — keep ids unique. **Exception:** intentional duplicates for visual
  clarity (same `label`, different `id`) are encouraged; see the "Visual
  clarity for humans" section in `SKILL.md`.
- `name` empty string → reject.
