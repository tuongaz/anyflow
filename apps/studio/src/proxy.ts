/**
 * Play proxy: runs the script declared on a node and broadcasts
 * `node:running` / `node:done` / `node:error` SSE events around the spawn so
 * the canvas can animate. US-001 ships a placeholder that returns an error
 * envelope — US-003 replaces this with a real script spawner using the
 * ProcessSpawner abstraction from US-002.
 */

import type { EventBus } from './events.ts';
import type { PlayAction } from './schema.ts';

export interface PlayResult {
  /** Correlates this run across SSE events + the synchronous response. */
  runId: string;
  /** Upstream status (filled when the spawn completed). */
  status?: number;
  /** Parsed JSON body or raw string body. */
  body?: unknown;
  /** Spawn-level error (script not found, exit !== 0, timeout, etc.). */
  error?: string;
}

export interface RunPlayOptions {
  events: EventBus;
  demoId: string;
  nodeId: string;
  action: PlayAction;
}

const NOT_IMPLEMENTED = 'script-based playAction runner not yet implemented (US-003)';

export async function runPlay(options: RunPlayOptions): Promise<PlayResult> {
  const { events, demoId, nodeId, action } = options;
  const runId = crypto.randomUUID();

  events.broadcast({
    type: 'node:running',
    demoId,
    payload: {
      nodeId,
      runId,
      interpreter: action.interpreter,
      scriptPath: action.scriptPath,
    },
  });

  events.broadcast({
    type: 'node:error',
    demoId,
    payload: { nodeId, runId, message: NOT_IMPLEMENTED },
  });

  return { runId, error: NOT_IMPLEMENTED };
}
