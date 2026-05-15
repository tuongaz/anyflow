import type { EventBus, OrderCreatedEvent } from './event-bus.ts';
import type { Queue, ShipmentRequest } from './queue.ts';
import type { OrderStore } from './store.ts';

const STUDIO_URL = (globalThis.process?.env?.SEEFLOW_STUDIO_URL ?? 'http://localhost:4321').replace(
  /\/+$/,
  '',
);

const DEMO_SLUG = 'order-pipeline';
const INVENTORY_NODE_ID = 'inventory-worker';
const SHIPPING_NODE_ID = 'shipping-worker';
const INVENTORY_DELAY_MS = 250;
const SHIPPING_DELAY_MS = 400;

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
  nodeId: string,
  status: 'running' | 'done' | 'error',
  runId: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  if (cachedDemoId === null) cachedDemoId = await lookupDemoId();
  if (!cachedDemoId) return;
  try {
    await fetch(`${STUDIO_URL}/api/emit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demoId: cachedDemoId, nodeId, status, runId, payload }),
    });
  } catch (err) {
    console.warn(`[worker:${nodeId}] emit ${status} failed:`, err);
  }
}

export function startInventoryWorker(bus: EventBus, store: OrderStore): () => void {
  return bus.on('order.created', async (event: OrderCreatedEvent) => {
    const runId = crypto.randomUUID();
    await emit(INVENTORY_NODE_ID, 'running', runId, { orderId: event.orderId });
    await new Promise((r) => setTimeout(r, INVENTORY_DELAY_MS));
    store.setStatus(event.orderId, 'inventory-confirmed');
    await emit(INVENTORY_NODE_ID, 'done', runId, {
      orderId: event.orderId,
      itemsConfirmed: true,
    });
  });
}

export function startShippingWorker(queue: Queue, store: OrderStore): void {
  queue.subscribe(async (msg: ShipmentRequest) => {
    const runId = crypto.randomUUID();
    await emit(SHIPPING_NODE_ID, 'running', runId, { orderId: msg.orderId });
    await new Promise((r) => setTimeout(r, SHIPPING_DELAY_MS));
    store.setStatus(msg.orderId, 'shipped', { shippedAt: Date.now() });
    await emit(SHIPPING_NODE_ID, 'done', runId, {
      orderId: msg.orderId,
      shippedAt: Date.now(),
    });
  });
}
