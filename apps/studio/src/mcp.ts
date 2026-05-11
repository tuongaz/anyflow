import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Registry } from './registry.ts';
import type { DemoWatcher } from './watcher.ts';

export interface CreateMcpServerOptions {
  registry: Registry;
  watcher?: DemoWatcher;
}

// Future stories register tools by pushing into this list inside
// `createMcpServer`. Each tool has a tiny one-sentence description, a JSON
// Schema for its input (built from existing Zod schemas via zod-to-json-schema),
// and a handler that calls the same Outcome-returning inner helper the REST
// handler uses.
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown) => Promise<CallToolResult>;
}

/**
 * Build a fresh MCP Server scoped to a registry + watcher. The server speaks
 * `tools/list` and `tools/call` against the tool list — empty until later
 * stories populate it — and is wired to a transport by the caller (see the
 * /mcp route in server.ts and the stdio shim in mcp-shim.ts).
 */
export function createMcpServer(_options: CreateMcpServerOptions): Server {
  const tools: McpTool[] = [];

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
