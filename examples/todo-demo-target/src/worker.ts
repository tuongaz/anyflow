import type { EventBus, TodoCompletedEvent } from './event-bus.ts';

const STUDIO_URL = (globalThis.process?.env?.ANYDEMO_STUDIO_URL ?? 'http://localhost:4321').replace(
  /\/+$/,
  '',
);

const DEMO_SLUG = 'todo-demo';
const WORKER_NODE_ID = 'todo-worker';
const PROCESSING_DELAY_MS = 250;

let cachedDemoId: string | null = null;

async function lookupDemoId(): Promise<string | null> {
  try {
    const res = await fetch(`${STUDIO_URL}/api/demos`);
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{ id: string; slug: string }>;
    return list.find((d) => d.slug === DEMO_SLUG)?.id ?? null;
  } catch {
    return null;
  }
}

async function emit(
  demoId: string,
  status: 'running' | 'done' | 'error',
  runId: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`${STUDIO_URL}/api/emit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demoId, nodeId: WORKER_NODE_ID, status, runId, payload }),
    });
  } catch (err) {
    console.warn(`[worker] emit ${status} failed:`, err);
  }
}

export function startWorker(bus: EventBus): () => void {
  return bus.on('todo.completed', async (event: TodoCompletedEvent) => {
    if (cachedDemoId === null) cachedDemoId = await lookupDemoId();
    const demoId = cachedDemoId;
    if (!demoId) {
      console.warn(
        `[worker] studio at ${STUDIO_URL} has no demo with slug "${DEMO_SLUG}"; skipping emit. Run \`anydemo register --path .\` first.`,
      );
      return;
    }

    const runId = crypto.randomUUID();
    await emit(demoId, 'running', runId, { todoId: event.todoId });
    await new Promise((r) => setTimeout(r, PROCESSING_DELAY_MS));
    await emit(demoId, 'done', runId, { todoId: event.todoId, processedAt: Date.now() });
  });
}
