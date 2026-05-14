#!/usr/bin/env bun
import { resolveStudioUrl } from './studio-config';

const DEFAULT_HARD_CEILING_MS = 120_000;
const DEFAULT_STATUS_WAIT_MS = 10_000;

export interface PlayOutcome {
  nodeId: string;
  outcome: 'ok' | 'failed';
  runId?: string;
  body?: unknown;
  error?: string;
}

export interface StatusFirstReport {
  state: string;
  summary?: string;
  detail?: string;
  ts?: number;
}

export interface StatusOutcome {
  nodeId: string;
  outcome: 'ok' | 'failed';
  firstReport?: StatusFirstReport;
  error?: string;
}

export interface SkippedItem {
  nodeId: string;
  reason: string;
}

export interface ValidationReport {
  ok: boolean;
  plays: PlayOutcome[];
  statuses: StatusOutcome[];
  skipped: SkippedItem[];
}

export interface ValidateOptions {
  demoId: string;
  url?: string;
  hardCeilingMs?: number;
  statusWaitMs?: number;
}

interface MaybeAction {
  validationSafe?: boolean;
  [k: string]: unknown;
}

interface NodeShape {
  id: string;
  type: string;
  data?: {
    playAction?: MaybeAction;
    statusAction?: unknown;
  };
}

interface DemoShape {
  nodes?: NodeShape[];
}

interface DemoGetResponse {
  id?: string;
  valid?: boolean;
  error?: string | null;
  demo?: DemoShape | null;
}

interface SseEvent {
  event: string;
  data: string;
}

interface SseChannel {
  next(timeoutMs: number): Promise<SseEvent | null>;
  close(): void;
}

function openSseChannel(body: ReadableStream<Uint8Array>): SseChannel {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  const queue: SseEvent[] = [];
  const waiters: Array<() => void> = [];
  let buffer = '';
  let ended = false;
  let cancelled = false;

  const wake = () => {
    while (waiters.length > 0) {
      const w = waiters.shift();
      if (w) w();
    }
  };

  const flushBlock = (block: string) => {
    let eventType = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const piece = line.slice(5).replace(/^ /, '');
        data = data.length === 0 ? piece : `${data}\n${piece}`;
      }
    }
    queue.push({ event: eventType, data });
  };

  void (async () => {
    try {
      while (!cancelled) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          flushBlock(block);
          idx = buffer.indexOf('\n\n');
        }
        if (queue.length > 0) wake();
      }
    } catch {
      // swallow — surface as `ended` to consumers
    } finally {
      ended = true;
      wake();
    }
  })();

  return {
    async next(timeoutMs) {
      const deadline = Date.now() + Math.max(0, timeoutMs);
      while (queue.length === 0 && !ended) {
        const left = deadline - Date.now();
        if (left <= 0) return null;
        const woke = await new Promise<boolean>((resolve) => {
          const t = setTimeout(() => resolve(false), left);
          waiters.push(() => {
            clearTimeout(t);
            resolve(true);
          });
        });
        if (!woke) return null;
      }
      return queue.shift() ?? null;
    },
    close() {
      cancelled = true;
      reader.cancel().catch(() => {});
      wake();
    },
  };
}

function hasPlayAction(node: NodeShape): boolean {
  return (
    (node.type === 'playNode' || node.type === 'stateNode') && node.data?.playAction !== undefined
  );
}

function hasStatusAction(node: NodeShape): boolean {
  return (
    (node.type === 'playNode' || node.type === 'stateNode') && node.data?.statusAction !== undefined
  );
}

export async function validateEndToEnd(options: ValidateOptions): Promise<ValidationReport> {
  const url = options.url ?? resolveStudioUrl();
  const hardCeilingMs = options.hardCeilingMs ?? DEFAULT_HARD_CEILING_MS;
  const statusWaitMs = options.statusWaitMs ?? DEFAULT_STATUS_WAIT_MS;
  const startedAt = Date.now();
  const overallDeadline = startedAt + hardCeilingMs;

  const plays: PlayOutcome[] = [];
  const statuses: StatusOutcome[] = [];
  const skipped: SkippedItem[] = [];

  const demoRes = await globalThis.fetch(`${url}/api/demos/${options.demoId}`);
  if (!demoRes.ok) {
    return {
      ok: false,
      plays,
      statuses,
      skipped: [
        {
          nodeId: '<demo>',
          reason: `GET /api/demos/${options.demoId} returned HTTP ${demoRes.status}`,
        },
      ],
    };
  }
  const demoData = (await demoRes.json()) as DemoGetResponse;
  if (!demoData.valid || !demoData.demo) {
    return {
      ok: false,
      plays,
      statuses,
      skipped: [
        {
          nodeId: '<demo>',
          reason: `demo not valid: ${demoData.error ?? '<no error>'}`,
        },
      ],
    };
  }

  const nodes = demoData.demo.nodes ?? [];

  const playTargets: string[] = [];
  for (const node of nodes) {
    if (!hasPlayAction(node)) continue;
    const action = node.data?.playAction as MaybeAction | undefined;
    if (action?.validationSafe === false) {
      skipped.push({ nodeId: node.id, reason: 'playAction.validationSafe is false' });
      continue;
    }
    playTargets.push(node.id);
  }
  const statusTargets = nodes.filter(hasStatusAction).map((n) => n.id);

  let channel: SseChannel | undefined;
  if (statusTargets.length > 0) {
    try {
      const sseRes = await globalThis.fetch(`${url}/api/events?demoId=${options.demoId}`, {
        headers: { accept: 'text/event-stream' },
      });
      if (!sseRes.ok || !sseRes.body) {
        for (const nid of statusTargets) {
          statuses.push({
            nodeId: nid,
            outcome: 'failed',
            error: `failed to open SSE stream: HTTP ${sseRes.status}`,
          });
        }
      } else {
        channel = openSseChannel(sseRes.body);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const nid of statusTargets) {
        statuses.push({
          nodeId: nid,
          outcome: 'failed',
          error: `failed to open SSE stream: ${message}`,
        });
      }
    }
  }

  for (const nodeId of playTargets) {
    if (Date.now() > overallDeadline) {
      plays.push({ nodeId, outcome: 'failed', error: 'hard ceiling exceeded before play' });
      continue;
    }
    let res: Response;
    try {
      res = await globalThis.fetch(`${url}/api/demos/${options.demoId}/play/${nodeId}`, {
        method: 'POST',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      plays.push({ nodeId, outcome: 'failed', error: message });
      continue;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      plays.push({ nodeId, outcome: 'failed', body, error: `HTTP ${res.status}` });
      continue;
    }
    const parsed = (body ?? {}) as { runId?: string; error?: string };
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      plays.push({ nodeId, outcome: 'failed', runId: parsed.runId, body });
    } else {
      plays.push({ nodeId, outcome: 'ok', runId: parsed.runId, body });
    }
  }

  if (channel && statusTargets.length > 0) {
    const observed = new Map<string, StatusOutcome>();
    const remaining = new Set(statusTargets);
    const phaseDeadline = Math.min(Date.now() + statusWaitMs, overallDeadline);

    while (remaining.size > 0) {
      const left = phaseDeadline - Date.now();
      if (left <= 0) break;
      const evt = await channel.next(left);
      if (!evt) break;
      if (evt.event !== 'node:status') continue;
      let payload: {
        nodeId?: unknown;
        state?: unknown;
        summary?: unknown;
        detail?: unknown;
        ts?: unknown;
      };
      try {
        payload = JSON.parse(evt.data);
      } catch {
        continue;
      }
      const pid = payload?.nodeId;
      const state = payload?.state;
      if (typeof pid !== 'string' || typeof state !== 'string') continue;
      if (!remaining.has(pid)) continue;
      if (state === 'error') continue;
      observed.set(pid, {
        nodeId: pid,
        outcome: 'ok',
        firstReport: {
          state,
          summary: typeof payload.summary === 'string' ? payload.summary : undefined,
          detail: typeof payload.detail === 'string' ? payload.detail : undefined,
          ts: typeof payload.ts === 'number' ? payload.ts : undefined,
        },
      });
      remaining.delete(pid);
    }
    channel.close();

    const overallExceeded = Date.now() > overallDeadline;
    for (const nid of statusTargets) {
      const seen = observed.get(nid);
      if (seen) {
        statuses.push(seen);
      } else {
        statuses.push({
          nodeId: nid,
          outcome: 'failed',
          error: overallExceeded
            ? 'hard ceiling exceeded before status received'
            : 'no non-error status received within timeout',
        });
      }
    }
  }

  const allPlaysOk = plays.every((p) => p.outcome === 'ok');
  const allStatusesOk = statuses.every((s) => s.outcome === 'ok');
  const ok = allPlaysOk && allStatusesOk && Date.now() <= overallDeadline;

  return { ok, plays, statuses, skipped };
}

export async function main(argv: string[]): Promise<number> {
  const demoId = argv[0];
  if (!demoId) {
    process.stderr.write('Usage: validate-end-to-end.ts <demoId>\n');
    return 1;
  }
  const report = await validateEndToEnd({ demoId });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
