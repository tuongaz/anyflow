import { z } from 'zod';

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// Curated palette tokens. Stored on disk as readable names; the frontend maps
// them to actual CSS values (theme-aware, light + dark).
export const ColorTokenSchema = z.enum([
  'default',
  'slate',
  'blue',
  'green',
  'amber',
  'red',
  'purple',
  'pink',
]);

// Visual fields shared by every node type (functional + decorative). All
// optional — existing demo files predate them and must continue to parse.
const NodeVisualBaseShape = {
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  borderColor: ColorTokenSchema.optional(),
  backgroundColor: ColorTokenSchema.optional(),
  borderSize: z.number().positive().optional(),
  borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  fontSize: z.number().positive().optional(),
  cornerRadius: z.number().min(0).optional(),
};

const HttpActionSchema = z.object({
  kind: z.literal('http'),
  method: HttpMethodSchema,
  url: z.string().min(1),
  body: z.unknown().optional(),
  bodySchema: z.unknown().optional(),
});

const PlayActionSchema = HttpActionSchema;

const DynamicSourceSchema = HttpActionSchema;

const DetailFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
});

// Two free-text descriptions. `summary` is the short one rendered ON the
// node itself (kept concise so it fits the box without wrapping into a wall
// of text); `description` is the long one rendered in the detail panel when
// a node is selected. Both are optional, so existing demos that only set
// `summary` keep displaying the same text in the panel via fallback.
const DetailSchema = z.object({
  filePath: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(DetailFieldSchema).optional(),
  dynamicSource: DynamicSourceSchema.optional(),
});

const StateSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('request') }),
  z.object({ kind: z.literal('event') }),
]);

const NodeDataBaseSchema = z.object({
  label: z.string().min(1),
  kind: z.string().min(1),
  stateSource: StateSourceSchema,
  detail: DetailSchema.optional(),
  // Reserved for v2: a module path resolved by future skills runtime.
  // Schema-only at v1 — never read at runtime.
  handlerModule: z.string().optional(),
  ...NodeVisualBaseShape,
});

const PlayNodeDataSchema = NodeDataBaseSchema.extend({
  playAction: PlayActionSchema,
});

const StateNodeDataSchema = NodeDataBaseSchema.extend({
  playAction: PlayActionSchema.optional(),
});

const PlayNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('playNode'),
  position: PositionSchema,
  data: PlayNodeDataSchema,
});

const StateNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('stateNode'),
  position: PositionSchema,
  data: StateNodeDataSchema,
});

// Decorative annotation node — rectangle / ellipse / sticky. No semantic
// payload (no kind/stateSource/playAction); reuses NodeVisualBaseShape so
// users can theme it the same way as functional nodes.
const ShapeKindSchema = z.enum(['rectangle', 'ellipse', 'sticky', 'text']);

const ShapeNodeDataSchema = z.object({
  shape: ShapeKindSchema,
  label: z.string().optional(),
  ...NodeVisualBaseShape,
});

const ShapeNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('shapeNode'),
  position: PositionSchema,
  data: ShapeNodeDataSchema,
});

// Decorative image node — embeds a base64 data URL on the canvas. No semantic
// payload; reuses NodeVisualBaseShape so it themes the same way as other nodes.
const ImageNodeDataSchema = z.object({
  image: z
    .string()
    .min(1)
    .refine((s) => s.startsWith('data:image/'), {
      message: 'image must be a data URL starting with "data:image/"',
    }),
  alt: z.string().optional(),
  ...NodeVisualBaseShape,
});

const ImageNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('imageNode'),
  position: PositionSchema,
  data: ImageNodeDataSchema,
});

// Decorative icon node — renders a Lucide glyph on the canvas. Unboxed
// (no border/cornerRadius/backgroundColor) so it does NOT spread
// NodeVisualBaseShape; only `width` / `height` are reused for resizing.
const IconNodeDataSchema = z.object({
  icon: z.string().min(1),
  color: ColorTokenSchema.optional(),
  strokeWidth: z.number().min(0.5).max(4).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  alt: z.string().optional(),
  // US-002: optional visible caption rendered below the icon. Distinct from
  // `alt` (screen-reader text). Absent / empty → no caption rendered and the
  // node's bounding box is byte-identical to the unlabeled layout.
  label: z.string().optional(),
});

const IconNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('iconNode'),
  position: PositionSchema,
  data: IconNodeDataSchema,
});

const NodeSchema = z.discriminatedUnion('type', [
  PlayNodeSchema,
  StateNodeSchema,
  ShapeNodeSchema,
  ImageNodeSchema,
  IconNodeSchema,
]);

// Connector is the semantic edge between two nodes — describes HOW they are
// connected, not just THAT they are. Discriminated on `kind`:
//   • http    — service-to-service HTTP call (method + url echo of the playAction)
//   • event   — pub/sub event (eventName)
//   • queue   — message-queue handoff (queueName)
//   • default — user-drawn, no semantic payload (UI annotation only)
// The frontend derives a React Flow Edge from each connector at render time
// (id/source/target are reused; `label` becomes the edge label; visual style
// is picked from `kind`, but per-connector `style`/`color` overrides it). v1
// has no separate `edges[]` array — connectors are the sole source of truth
// for inter-node connections.
const ConnectorStyleSchema = z.enum(['solid', 'dashed', 'dotted']);
const ConnectorDirectionSchema = z.enum(['forward', 'backward', 'both']);
// Path geometry — orthogonal to `style` (which means the dash pattern). Absent
// → renders as today's smooth bezier curve. 'step' renders as a smoothstep
// (right-angle / zigzag) path. (US-017)
const ConnectorPathSchema = z.enum(['curve', 'step']);

// Visual fields shared by every connector kind. All optional — existing
// demo files predate them and must continue to parse. `direction` defaults
// to 'forward' when absent (the historical behavior).
const ConnectorVisualBaseShape = {
  style: ConnectorStyleSchema.optional(),
  color: ColorTokenSchema.optional(),
  direction: ConnectorDirectionSchema.optional(),
  borderSize: z.number().positive().optional(),
  path: ConnectorPathSchema.optional(),
  // US-018: per-connector label font size in CSS pixels. Absent → fall back to
  // the editable-edge default (11px). Mirrors NodeVisualBaseShape.fontSize.
  fontSize: z.number().positive().optional(),
};

// Handle ids — every node kind in this codebase uses the same four-handle
// layout: target-only on top + left, source-only on right + bottom (US-013).
// `sourceHandle` MUST be a source-side id and `targetHandle` MUST be a
// target-side id; sending the wrong role leaves a stranded endpoint at render
// time, so the schema rejects it (US-022).
export const SourceHandleIdSchema = z.enum(['r', 'b']);
export const TargetHandleIdSchema = z.enum(['t', 'l']);

// US-006: pinned endpoint position. `side` names one of the four perimeter
// sides of the connected node; `t` is the parameterized position along that
// side, [0, 1], measured from the top-left corner of the side (top/bottom →
// left-to-right; left/right → top-to-bottom). Pins are persisted so they
// survive node moves and resizes without drifting toward the other endpoint's
// center the way floating endpoints do.
const EdgePinSideSchema = z.enum(['top', 'right', 'bottom', 'left']);
export const EdgePinSchema = z.object({
  side: EdgePinSideSchema,
  t: z.number().min(0).max(1),
});

const ConnectorBaseShape = {
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  // Optional — connectors authored before the four-handle layout omit them and
  // React Flow falls back to the first matching handle.
  sourceHandle: SourceHandleIdSchema.optional(),
  targetHandle: TargetHandleIdSchema.optional(),
  // US-021: tracks whether each endpoint's handle was auto-picked by the
  // facing-handle picker (true) or pinned by an explicit user handle drop
  // (false / absent). Auto-picked endpoints get re-routed when nodes move so
  // the connector keeps facing the other end; user-pinned ones never do.
  sourceHandleAutoPicked: z.boolean().optional(),
  targetHandleAutoPicked: z.boolean().optional(),
  // US-006: optional explicit perimeter positions for each endpoint. When
  // set, the endpoint is computed from `(side, t)` against the connected
  // node's current bbox at render time — the position parameterizes with the
  // node so the pin survives moves and resizes. Absent → floating /
  // handle-based endpoint behavior (back-compat).
  sourcePin: EdgePinSchema.optional(),
  targetPin: EdgePinSchema.optional(),
  label: z.string().optional(),
  ...ConnectorVisualBaseShape,
};

const HttpConnectorSchema = z.object({
  ...ConnectorBaseShape,
  kind: z.literal('http'),
  method: HttpMethodSchema.optional(),
  url: z.string().min(1).optional(),
});

const EventConnectorSchema = z.object({
  ...ConnectorBaseShape,
  kind: z.literal('event'),
  eventName: z.string().min(1),
});

const QueueConnectorSchema = z.object({
  ...ConnectorBaseShape,
  kind: z.literal('queue'),
  queueName: z.string().min(1),
});

const DefaultConnectorSchema = z.object({
  ...ConnectorBaseShape,
  kind: z.literal('default'),
});

const ConnectorSchema = z.discriminatedUnion('kind', [
  HttpConnectorSchema,
  EventConnectorSchema,
  QueueConnectorSchema,
  DefaultConnectorSchema,
]);

export const DemoSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
    nodes: z.array(NodeSchema),
    connectors: z.array(ConnectorSchema),
    // Optional declarative endpoint the studio POSTs to when the user resets
    // the demo. Lets the running app reset its own in-memory state alongside
    // the canvas reload broadcast (US-003 / US-008).
    resetAction: HttpActionSchema.optional(),
  })
  .superRefine((demo, ctx) => {
    const nodeIds = new Set(demo.nodes.map((n) => n.id));
    demo.connectors.forEach((c, idx) => {
      if (!nodeIds.has(c.source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['connectors', idx, 'source'],
          message: `Connector ${c.id} references unknown source node: ${c.source}`,
        });
      }
      if (!nodeIds.has(c.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['connectors', idx, 'target'],
          message: `Connector ${c.id} references unknown target node: ${c.target}`,
        });
      }
    });
  });

export type Demo = z.infer<typeof DemoSchema>;
export type DemoNode = z.infer<typeof NodeSchema>;
export type ShapeNode = z.infer<typeof ShapeNodeSchema>;
export type ImageNode = z.infer<typeof ImageNodeSchema>;
export type IconNode = z.infer<typeof IconNodeSchema>;
export type ShapeKind = z.infer<typeof ShapeKindSchema>;
export type ColorToken = z.infer<typeof ColorTokenSchema>;
export type Connector = z.infer<typeof ConnectorSchema>;
export type HttpConnector = z.infer<typeof HttpConnectorSchema>;
export type EventConnector = z.infer<typeof EventConnectorSchema>;
export type QueueConnector = z.infer<typeof QueueConnectorSchema>;
export type DefaultConnector = z.infer<typeof DefaultConnectorSchema>;
export type ConnectorStyle = z.infer<typeof ConnectorStyleSchema>;
export type ConnectorDirection = z.infer<typeof ConnectorDirectionSchema>;
export type ConnectorPath = z.infer<typeof ConnectorPathSchema>;
export type EdgePin = z.infer<typeof EdgePinSchema>;
export type EdgePinSide = z.infer<typeof EdgePinSideSchema>;
export type PlayAction = z.infer<typeof PlayActionSchema>;
export type DynamicSource = z.infer<typeof DynamicSourceSchema>;
export type ResetAction = z.infer<typeof HttpActionSchema>;
export type StateSource = z.infer<typeof StateSourceSchema>;
