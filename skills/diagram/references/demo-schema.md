# Demo Schema Reference

The studio's `/api/demos/validate` and `/api/demos/register` endpoints reject
anything that doesn't match this schema exactly. Every phase of the
diagram pipeline that emits JSON nodes or connectors (Phase 5 wiring,
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
type Node = PlayNode | StateNode | ShapeNode | ImageNode | HtmlNode;
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
    shape: 'rectangle' | 'ellipse' | 'sticky' | 'text' | 'database';
    label?: string;
    // visual fields (same as PlayNode)
  };
}
```

`shape: 'database'` is an *illustrative* cylinder (SVG with rounded top/bottom),
intended for static datastore visuals next to playNodes/stateNodes that read or
write it. Authors typically pair it with `kind: "database"` on the *adjacent*
stateNode that actually carries the request/event source — the shapeNode itself
has no `kind` field. Default size is 120 × 140. When `shape: 'database'` is set,
the rectangular chrome (border/background classes) is cleared so only the SVG
paints; the `borderColor` / `backgroundColor` ColorToken fields still apply to
the SVG stroke / fill.

**ImageNode** — decorative; references a file under `<project>/.anydemo/`
by relative path. The renderer fetches via
`GET /api/projects/:id/files/:path` and the studio's watcher tracks the file
for hot-reload (`file:changed` SSE).

```ts
{
  id: string;
  type: 'imageNode';
  position: { x: number; y: number };
  data: {
    path: string;                 // relative to <project>/.anydemo/, e.g. "assets/logo.png"
                                  // NO leading slash, NO ".." segments, NOT a data: URL
    alt?: string;
    // visual fields (same as PlayNode)
  };
}
```

The image file MUST already exist under `<project>/.anydemo/<path>` before the
demo loads — author it by hand into `.anydemo/assets/<name>.<ext>`, or upload
via the canvas (drag-and-drop) which writes through `POST /api/projects/:id/files/upload`.

**HtmlNode** — decorative escape-hatch; renders author-written HTML fetched from
a relative path under `<project>/.anydemo/`. Use for legends, callouts, rich
annotations, or any content the curated nodes don't cover. The studio's
renderer pipes the file through a sanitizer (strips `<script>`, `on*=`
handlers, `javascript:` URLs) before injection, and Tailwind utility classes
work because the runtime is auto-loaded on first htmlNode mount.

```ts
{
  id: string;
  type: 'htmlNode';
  position: { x: number; y: number };
  data: {
    htmlPath: string;             // relative to <project>/.anydemo/, e.g. "blocks/legend.html"
                                  // NO leading slash, NO ".." segments
    label?: string;               // optional caption rendered below the content
    // visual fields (same as PlayNode — applied to the wrapper)
  };
}
```

The convention for studio-created htmlNodes is `htmlPath: "blocks/<id>.html"`
(matching the node's own `id` so the file is auto-managed: created on
drop-create, deleted on node-delete). Hand-authored htmlNodes can point at any
path under `.anydemo/` — e.g. `blocks/legend.html` or `content/intro.html` —
as long as the file is a clean relative path. If the file is missing at load
time, the renderer shows a `PlaceholderCard` with "Missing: &lt;htmlPath&gt;"
instead of failing the parse.

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
  summary?: string;              // SHORT — rendered ON the node; keep ≤ 60 chars / one sentence
  description?: string;          // LONG  — rendered in the detail panel; full-prose context
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
          "summary": "Creates an order; emits orders.created.",
          "description": "Persists a new order row in the orders table and publishes an `orders.created` event for the shipping + invoicing workers to pick up. Returns the new order id synchronously; the rest of the pipeline runs async via the event bus.",
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

## Illustrative database shape + htmlNode

The snippet below shows one `shapeNode` with `data.shape: 'database'` (placed
next to a stateNode that carries the request source) and one `htmlNode`
referencing `blocks/legend.html` for a custom legend block. Both compose with
the canonical example above.

```json
{
  "nodes": [
    {
      "id": "db-orders-cyl",
      "type": "shapeNode",
      "position": { "x": 600, "y": 0 },
      "data": { "shape": "database", "label": "Orders DB" }
    },
    {
      "id": "db-orders",
      "type": "stateNode",
      "position": { "x": 600, "y": 180 },
      "data": {
        "label": "Orders DB",
        "kind": "database",
        "stateSource": { "kind": "request" },
        "detail": {
          "summary": "Stores order rows.",
          "description": "Postgres table holding one row per order. Written by `POST /orders`, read by the shipping worker."
        }
      }
    },
    {
      "id": "legend-block",
      "type": "htmlNode",
      "position": { "x": 0, "y": 400 },
      "data": {
        "htmlPath": "blocks/legend.html",
        "label": "Legend"
      }
    }
  ]
}
```

The illustrative `shapeNode` provides the cylinder *visual* while the adjacent
`stateNode` carries the actual `kind` / `stateSource` / `detail` payload —
keeping the data contract on the stateNode and the icon-style chrome on the
shapeNode. The `htmlNode` is rendered from `<project>/.anydemo/blocks/legend.html`
(the studio writes a starter file when you drop the node from the canvas
toolbar; hand-edit the file in `$EDITOR` to customise it).

## Common rejection causes

- `version` not literal `1` → reject.
- Connector `source`/`target` doesn't match any node `id` → reject.
- `EventConnector` without `eventName` (or empty) → reject.
- `QueueConnector` without `queueName` → reject.
- `PlayNode` without `playAction` → reject.
- `imageNode.data.path` is absolute, contains `..` segments, or is a `data:` URL → reject. Must be a clean relative path under `.anydemo/` (e.g. `assets/logo.png`).
- `htmlNode.data.htmlPath` is empty, absolute, or contains `..` segments → reject. Must be a clean relative path under `.anydemo/` (e.g. `blocks/legend.html`). Missing-on-disk is NOT a rejection — the renderer shows a placeholder.
- `shapeNode.data.shape` outside the allowed set (`'rectangle' | 'ellipse' | 'sticky' | 'text' | 'database'`) → reject.
- `sourceHandle: 't'` / `targetHandle: 'r'` (wrong role) → reject.
- Duplicate node ids or duplicate connector ids → undefined behavior; the
  studio's assemble endpoint dedupes, but author-side duplicates indicate a
  bug — keep ids unique. **Exception:** intentional duplicates for visual
  clarity (same `label`, different `id`) are encouraged; see the "Visual
  clarity for humans" section in `SKILL.md`.
- `name` empty string → reject.
