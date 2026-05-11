import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type ZodTypeAny, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CreateProjectBodySchema,
  type OperationsDeps,
  PositionBodySchema,
  RegisterBodySchema,
  ReorderBodySchema,
  addNodeImpl,
  createProjectImpl,
  deleteDemoImpl,
  deleteNodeImpl,
  getDemoImpl,
  listDemosImpl,
  moveNodeImpl,
  registerDemoImpl,
  reorderNodeImpl,
} from './operations.ts';
import type { Registry } from './registry.ts';
import type { DemoWatcher } from './watcher.ts';

export interface CreateMcpServerOptions {
  registry: Registry;
  watcher?: DemoWatcher;
}

// Tools are pushed into this in-memory list inside `createMcpServer`. Each
// tool has a tiny one-sentence description, a JSON Schema for its input
// (built from existing Zod schemas via zod-to-json-schema where reuse is
// possible), and a handler that calls the same Outcome-returning inner
// helper the REST handler uses.
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown) => Promise<CallToolResult>;
}

// zod-to-json-schema emits `$schema` and other top-level Draft fields by
// default. The MCP `tools/list` response carries `inputSchema` inline, so
// stripping the wrapper keeps the wire payload tidy without losing any of
// the actual shape constraints.
const inputSchemaFromZod = (schema: ZodTypeAny): Record<string, unknown> => {
  const json = zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>;
  const { $schema: _$schema, ...rest } = json;
  return rest;
};

const okResult = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

const errorResult = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});

// Most MCP tools take a single demoId argument. Defined inline as plain
// JSON Schema (rather than a one-off Zod schema) because there's no REST
// counterpart to share with.
const DEMO_ID_INPUT_SCHEMA = {
  type: 'object',
  properties: { demoId: { type: 'string', minLength: 1 } },
  required: ['demoId'],
  additionalProperties: false,
} as const;

const requireDemoId = (args: unknown): { demoId: string } | { error: string } => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { error: 'Invalid arguments: expected an object with demoId' };
  }
  const { demoId } = args as { demoId?: unknown };
  if (typeof demoId !== 'string' || demoId.length === 0) {
    return { error: 'Invalid arguments: demoId must be a non-empty string' };
  }
  return { demoId };
};

// {demoId, nodeId} body shape shared by move + reorder + delete inputs.
const DemoNodeIdBaseSchema = z.object({
  demoId: z.string().min(1),
  nodeId: z.string().min(1),
});

// add_node input: { demoId, node: <node payload> }. The inner `node` object is
// loose here (additionalProperties=true via passthrough) because DemoSchema
// runs the full validation server-side after the new node is merged in.
const AddNodeInputSchema = z.object({
  demoId: z.string().min(1),
  node: z.record(z.unknown()),
});

const DeleteNodeInputSchema = DemoNodeIdBaseSchema;

// move_node input: { demoId, nodeId } extended with PositionBodySchema's
// { x, y } fields so agents see one flat schema.
const MoveNodeInputSchema = DemoNodeIdBaseSchema.extend({
  x: PositionBodySchema.shape.x,
  y: PositionBodySchema.shape.y,
});

// reorder_node input: each branch of the existing ReorderBodySchema
// discriminated union extended with demoId/nodeId. Keeps the discriminator
// on `op` so the emitted JSON Schema is an oneOf the agent can introspect.
const ReorderNodeInputSchema = z.discriminatedUnion('op', [
  DemoNodeIdBaseSchema.extend({ op: z.literal('forward') }),
  DemoNodeIdBaseSchema.extend({ op: z.literal('backward') }),
  DemoNodeIdBaseSchema.extend({ op: z.literal('toFront') }),
  DemoNodeIdBaseSchema.extend({ op: z.literal('toBack') }),
  DemoNodeIdBaseSchema.extend({
    op: z.literal('toIndex'),
    index: z.number().int().nonnegative(),
  }),
]);

const buildTools = (deps: OperationsDeps): McpTool[] => [
  {
    name: 'anydemo_list_demos',
    description: 'List every demo registered with the studio.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const result = listDemosImpl(deps);
      return okResult(result.data);
    },
  },
  {
    name: 'anydemo_get_demo',
    description: 'Get the full demo definition and on-disk state for a demoId.',
    inputSchema: DEMO_ID_INPUT_SCHEMA,
    handler: async (args) => {
      const v = requireDemoId(args);
      if ('error' in v) return errorResult(v.error);
      const result = await getDemoImpl(deps, v.demoId);
      switch (result.kind) {
        case 'ok':
          return okResult(result.data);
        case 'notFound':
          return errorResult('not found');
        case 'fileNotFound':
          return errorResult(`Demo file not found: ${result.path}`);
      }
    },
  },
  {
    name: 'anydemo_register_demo',
    description: 'Register an existing demo file on disk with the studio.',
    inputSchema: inputSchemaFromZod(RegisterBodySchema),
    handler: async (args) => {
      const parsed = RegisterBodySchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid register body: ${JSON.stringify(parsed.error.issues)}`);
      }
      const result = await registerDemoImpl(deps, parsed.data);
      switch (result.kind) {
        case 'ok':
          return okResult(result.data);
        case 'fileNotFound':
          return errorResult(`Demo file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Demo file is not valid JSON: ${result.detail}`);
        case 'badSchema':
          return errorResult(
            `Demo file failed schema validation: ${JSON.stringify(result.issues)}`,
          );
        case 'sdkWriteFailed':
          return errorResult(`Failed to write SDK helper: ${result.message}`);
      }
    },
  },
  {
    name: 'anydemo_delete_demo',
    description: 'Unregister a demo from the studio (the on-disk file is left untouched).',
    inputSchema: DEMO_ID_INPUT_SCHEMA,
    handler: async (args) => {
      const v = requireDemoId(args);
      if ('error' in v) return errorResult(v.error);
      const result = deleteDemoImpl(deps, v.demoId);
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true });
        case 'notFound':
          return errorResult('not found');
      }
    },
  },
  {
    name: 'anydemo_create_project',
    description: 'Create a new AnyDemo project folder, or register an existing one.',
    inputSchema: inputSchemaFromZod(CreateProjectBodySchema),
    handler: async (args) => {
      const parsed = CreateProjectBodySchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid create project body: ${JSON.stringify(parsed.error.issues)}`);
      }
      const result = await createProjectImpl(deps, parsed.data);
      switch (result.kind) {
        case 'ok':
          return okResult(result.data);
        case 'invalidPath':
          return errorResult('folderPath must be an absolute filesystem path');
        case 'badJson':
          return errorResult(`Existing demo file is not valid JSON: ${result.detail}`);
        case 'badSchema':
          return errorResult(
            `Existing demo file failed schema validation: ${JSON.stringify(result.issues)}`,
          );
        case 'scaffoldFailed':
          return errorResult(
            `Failed to scaffold project at ${parsed.data.folderPath}: ${result.message}`,
          );
        case 'sdkWriteFailed':
          return errorResult(`Failed to write SDK helper: ${result.message}`);
      }
    },
  },
  {
    name: 'anydemo_add_node',
    description: 'Append a new node to a demo (cascade-safe; id auto-generated when omitted).',
    inputSchema: inputSchemaFromZod(AddNodeInputSchema),
    handler: async (args) => {
      const parsed = AddNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid add_node arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { demoId, node } = parsed.data;
      const result = await addNodeImpl(deps, demoId, node);
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true, id: result.data.id });
        case 'demoNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Demo file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Demo file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Demo failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
  {
    name: 'anydemo_delete_node',
    description: 'Delete a node and cascade-remove every connector touching it.',
    inputSchema: inputSchemaFromZod(DeleteNodeInputSchema),
    handler: async (args) => {
      const parsed = DeleteNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid delete_node arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { demoId, nodeId } = parsed.data;
      const result = await deleteNodeImpl(deps, demoId, nodeId);
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true });
        case 'demoNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Demo file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Demo file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Demo failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'unknownNode':
          return errorResult(`Unknown nodeId: ${nodeId}`);
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
  {
    name: 'anydemo_move_node',
    description: "Set a node's { x, y } canvas position.",
    inputSchema: inputSchemaFromZod(MoveNodeInputSchema),
    handler: async (args) => {
      const parsed = MoveNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid move_node arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { demoId, nodeId, x, y } = parsed.data;
      const result = await moveNodeImpl(deps, demoId, nodeId, { x, y });
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true, position: result.data.position });
        case 'demoNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Demo file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Demo file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Demo failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'unknownNode':
          return errorResult(`Unknown nodeId: ${nodeId}`);
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
  {
    name: 'anydemo_reorder_node',
    description:
      'Reorder a node within demo.nodes[] (forward / backward / toFront / toBack / toIndex).',
    inputSchema: inputSchemaFromZod(ReorderNodeInputSchema),
    handler: async (args) => {
      const parsed = ReorderNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          `Invalid reorder_node arguments: ${JSON.stringify(parsed.error.issues)}`,
        );
      }
      const { demoId, nodeId, ...body } = parsed.data;
      // Delegate the op-specific shape to the existing ReorderBodySchema so
      // reorderNodeImpl receives the same discriminated union the REST route
      // does — keeps a single source of truth for op semantics.
      const reorderBody = ReorderBodySchema.parse(body);
      const result = await reorderNodeImpl(deps, demoId, nodeId, reorderBody);
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true });
        case 'demoNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Demo file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Demo file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Demo failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'unknownNode':
          return errorResult(`Unknown nodeId: ${nodeId}`);
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
];

/**
 * Build a fresh MCP Server scoped to a registry + watcher. The server speaks
 * `tools/list` and `tools/call` against the tool list. Wired to a transport
 * by the caller (see the /mcp route in server.ts and the stdio shim in
 * mcp-shim.ts) — every request builds its own server in stateless mode.
 */
export function createMcpServer(options: CreateMcpServerOptions): Server {
  const tools = buildTools(options);

  const server = new Server({ name: 'anydemo', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      };
    }
    return tool.handler(request.params.arguments);
  });

  return server;
}
