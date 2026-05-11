import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CreateProjectBodySchema,
  type OperationsDeps,
  RegisterBodySchema,
  createProjectImpl,
  deleteDemoImpl,
  getDemoImpl,
  listDemosImpl,
  registerDemoImpl,
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
