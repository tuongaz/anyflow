#!/usr/bin/env bun
// AnyDemo MCP stdio shim.
//
// Bridges an MCP stdio client (e.g. Claude Code via .mcp.json) to the studio's
// HTTP `/mcp` endpoint. Every JSON-RPC message received on stdin is forwarded
// to the studio via a Streamable HTTP MCP client transport; every response is
// piped back to stdout. The shim never interprets tool semantics — it's a
// transparent JSON-RPC proxy keyed off message ids.
//
// Default target: http://127.0.0.1:4321/mcp. Override with ANYDEMO_STUDIO_URL.

import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type JSONRPCMessage, isJSONRPCRequest } from '@modelcontextprotocol/sdk/types.js';

const DEFAULT_URL = 'http://127.0.0.1:4321/mcp';
const STUDIO_NOT_RUNNING_MSG = 'AnyDemo studio is not running. Start it with `bun run dev` first.';
const STUDIO_WITHOUT_MCP_MSG = 'This studio version does not expose MCP. Upgrade required.';

const url = new URL(process.env.ANYDEMO_STUDIO_URL ?? DEFAULT_URL);

const stdio = new StdioServerTransport();
const http = new StreamableHTTPClientTransport(url);

// Walk the error and its `cause` chain looking for the signatures Bun and
// Node use for refused TCP connects. Bun's fetch surfaces this as a
// TypeError whose cause carries `code: 'ConnectionRefused'`; Node's undici
// uses `code: 'ECONNREFUSED'` on the cause. Match either pattern, plus the
// human-readable variants seen in the wild.
const isConnectionRefused = (err: unknown): boolean => {
  const seen = new Set<unknown>();
  const visit = (e: unknown): boolean => {
    if (!e || typeof e !== 'object' || seen.has(e)) return false;
    seen.add(e);
    const obj = e as Record<string, unknown>;
    const code = typeof obj.code === 'string' ? obj.code : '';
    if (code === 'ECONNREFUSED' || code === 'ConnectionRefused') return true;
    const message = typeof obj.message === 'string' ? obj.message : '';
    if (/econnrefused|connection refused|unable to connect/i.test(message)) return true;
    return visit(obj.cause);
  };
  return visit(err);
};

const isMcpNotMounted = (err: unknown): boolean =>
  err instanceof StreamableHTTPError && err.code === 404;

const errorMessageFor = (err: unknown): string => {
  if (isConnectionRefused(err)) return STUDIO_NOT_RUNNING_MSG;
  if (isMcpNotMounted(err)) return STUDIO_WITHOUT_MCP_MSG;
  return err instanceof Error ? err.message : String(err);
};

// Forward studio responses → stdout.
http.onmessage = (msg) => {
  void stdio.send(msg);
};
http.onerror = () => {
  // Errors are surfaced as JSON-RPC error responses by the stdio.onmessage
  // catch block below. Silence the transport's own onerror so a single fetch
  // failure doesn't double-log to stderr.
};

// Forward stdin requests → studio. On transport failure, synthesize a
// JSON-RPC error response so the upstream client sees a graceful error
// instead of a hang.
stdio.onmessage = async (msg) => {
  try {
    await http.send(msg);
  } catch (err) {
    if (!isJSONRPCRequest(msg)) return;
    const errorResponse: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32000, message: errorMessageFor(err) },
    };
    await stdio.send(errorResponse).catch(() => undefined);
  }
};

await http.start();
await stdio.start();

const shutdown = async () => {
  await stdio.close().catch(() => undefined);
  await http.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
