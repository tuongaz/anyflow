import { z } from 'zod';

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

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

const DetailSchema = z.object({
  filePath: z.string().optional(),
  summary: z.string().optional(),
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

const NodeSchema = z.discriminatedUnion('type', [PlayNodeSchema, StateNodeSchema]);

const EdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.string().optional(),
  animated: z.boolean().optional(),
});

export const DemoSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});

export type Demo = z.infer<typeof DemoSchema>;
export type DemoNode = z.infer<typeof NodeSchema>;
export type DemoEdge = z.infer<typeof EdgeSchema>;
export type PlayAction = z.infer<typeof PlayActionSchema>;
export type DynamicSource = z.infer<typeof DynamicSourceSchema>;
export type StateSource = z.infer<typeof StateSourceSchema>;
