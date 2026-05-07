/**
 * Play proxy: fires the HTTP action declared on a node and broadcasts
 * `node:running` / `node:done` / `node:error` SSE events around the fetch
 * so the canvas can animate. The originating fetch synchronously receives
 * the proxied response (status + body) so the user can see what their app
 * actually returned.
 */

import type { EventBus } from './events.ts';
import type { DynamicSource, PlayAction } from './schema.ts';

export interface PlayResult {
  /** Correlates this run across SSE events + the synchronous response. */
  runId: string;
  /** Upstream HTTP status (when the request reached the target). */
  status?: number;
  /** Parsed JSON body or raw string body. */
  body?: unknown;
  /** Network-level error (target unreachable, etc). */
  error?: string;
}

const isJsonContentType = (ct: string | null): boolean =>
  !!ct && ct.toLowerCase().includes('application/json');

const buildRequestInit = (action: PlayAction): RequestInit => {
  const init: RequestInit = { method: action.method };
  // Only attach body for methods that allow one. action.body may be JSON;
  // serialize automatically when present.
  if (action.body !== undefined && action.method !== 'GET') {
    init.body = typeof action.body === 'string' ? action.body : JSON.stringify(action.body);
    init.headers = { 'content-type': 'application/json' };
  }
  return init;
};

export interface RunPlayOptions {
  events: EventBus;
  demoId: string;
  nodeId: string;
  action: PlayAction;
}

export async function runPlay(options: RunPlayOptions): Promise<PlayResult> {
  const { events, demoId, nodeId, action } = options;
  const runId = crypto.randomUUID();

  events.broadcast({
    type: 'node:running',
    demoId,
    payload: { nodeId, runId, method: action.method, url: action.url },
  });

  try {
    const upstream = await fetch(action.url, buildRequestInit(action));
    const ct = upstream.headers.get('content-type');
    let body: unknown;
    if (isJsonContentType(ct)) {
      try {
        body = await upstream.json();
      } catch {
        body = await upstream.text();
      }
    } else {
      body = await upstream.text();
    }

    events.broadcast({
      type: 'node:done',
      demoId,
      payload: { nodeId, runId, status: upstream.status, body },
    });

    return { runId, status: upstream.status, body };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    events.broadcast({
      type: 'node:error',
      demoId,
      payload: { nodeId, runId, message },
    });
    return { runId, error: message };
  }
}

export interface DetailFetchResult {
  status?: number;
  body?: unknown;
  error?: string;
}

/**
 * Fires the request declared in `data.detail.dynamicSource` and returns the
 * proxied status + body. Unlike `runPlay`, this does NOT broadcast `node:*`
 * events — opening the detail panel is not a "run".
 */
export async function fetchDynamicDetail(action: DynamicSource): Promise<DetailFetchResult> {
  try {
    const upstream = await fetch(action.url, buildRequestInit(action));
    const ct = upstream.headers.get('content-type');
    let body: unknown;
    if (isJsonContentType(ct)) {
      try {
        body = await upstream.json();
      } catch {
        body = await upstream.text();
      }
    } else {
      body = await upstream.text();
    }
    return { status: upstream.status, body };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
