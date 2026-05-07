import { Hono } from 'hono';
import type { EventBus } from './event-bus.ts';
import type { Queue } from './queue.ts';
import type { OrderItem, OrderStore } from './store.ts';

export interface ServerOptions {
  store: OrderStore;
  bus: EventBus;
  shipments: Queue;
}

const DEFAULT_ITEMS: OrderItem[] = [
  { sku: 'sku-shirt', qty: 1 },
  { sku: 'sku-mug', qty: 2 },
];

export function createServer({ store, bus, shipments }: ServerOptions): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/orders', async (c) => {
    let body: { customerId?: unknown; items?: unknown } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      // tolerate empty body — Play action defaults below
    }
    const customerId =
      typeof body.customerId === 'string' && body.customerId.length > 0
        ? body.customerId
        : 'cust-1';
    const items =
      Array.isArray(body.items) && body.items.length > 0
        ? (body.items as OrderItem[])
        : DEFAULT_ITEMS;

    const order = store.create({ customerId, items });
    bus.emit('order.created', {
      orderId: order.id,
      customerId: order.customerId,
      total: order.total,
    });
    shipments.push({ orderId: order.id, customerId: order.customerId });

    return c.json(order, 201);
  });

  app.get('/orders', (c) => c.json(store.list()));

  app.get('/orders/:id', (c) => {
    const order = store.get(c.req.param('id'));
    if (!order) return c.json({ error: 'not found' }, 404);
    return c.json(order);
  });

  // HTTP-call leg: orders → payments. Marks the order paid synchronously so
  // the demo's http connector exercises a real cross-service call instead of
  // an in-process function.
  app.post('/payments/charge', async (c) => {
    let body: { orderId?: unknown } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      // fall through with empty body
    }
    const orderId =
      typeof body.orderId === 'string' && body.orderId.length > 0
        ? body.orderId
        : store.list().at(-1)?.id;
    if (!orderId) return c.json({ error: 'no order to charge' }, 400);

    const order = store.get(orderId);
    if (!order) return c.json({ error: `unknown order: ${orderId}` }, 404);

    const updated = store.setStatus(orderId, 'paid', { paidAt: Date.now() });
    return c.json({ orderId, status: 'paid', total: order.total, paidAt: updated?.paidAt });
  });

  app.get('/admin/stats', (c) =>
    c.json({ ...store.stats(), shipmentQueueDepth: shipments.depth() }),
  );

  return app;
}
