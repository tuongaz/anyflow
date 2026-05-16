import { emit } from '@seeflow/sdk';
import { Hono } from 'hono';

const app = new Hono();

const DEMO_ID_HEADER = 'x-seeflow-demo-id';
const RUN_ID_HEADER = 'x-seeflow-run-id';

const delay = () => new Promise((r) => setTimeout(r, 200 + Math.random() * 200));

app.post('/orders', async (c) => {
  const demoId = c.req.header(DEMO_ID_HEADER) ?? '';
  const runId = c.req.header(RUN_ID_HEADER) ?? '';
  const body = await c.req.json();
  const orderId = `ord_${Date.now()}`;

  await emit(demoId, 'post-orders', 'running', { runId });
  await delay();
  await emit(demoId, 'post-orders', 'done', { runId, payload: { orderId } });

  // Fire-and-forget so /orders returns immediately
  void fetch('http://localhost:3000/internal/inventory', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [DEMO_ID_HEADER]: demoId,
      [RUN_ID_HEADER]: runId,
    },
    body: JSON.stringify({ orderId, items: body.items }),
  });

  return c.json({ orderId });
});

app.post('/internal/inventory', async (c) => {
  const demoId = c.req.header(DEMO_ID_HEADER) ?? '';
  const runId = c.req.header(RUN_ID_HEADER) ?? '';
  const body = await c.req.json();

  await emit(demoId, 'inventory-service', 'running', { runId });
  await delay();
  await emit(demoId, 'inventory-service', 'done', {
    runId,
    payload: { reserved: body.items, warehouseId: 'wh_sydney' },
  });

  void fetch('http://localhost:3000/internal/payment', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [DEMO_ID_HEADER]: demoId,
      [RUN_ID_HEADER]: runId,
    },
    body: JSON.stringify({ orderId: body.orderId }),
  });

  return c.json({ ok: true });
});

app.post('/internal/payment', async (c) => {
  const demoId = c.req.header(DEMO_ID_HEADER) ?? '';
  const runId = c.req.header(RUN_ID_HEADER) ?? '';
  const body = await c.req.json();

  await emit(demoId, 'payment-service', 'running', { runId });
  await delay();
  await emit(demoId, 'payment-service', 'done', {
    runId,
    payload: { chargeId: `ch_${Date.now()}`, amount: 4999 },
  });

  void fetch('http://localhost:3000/internal/fulfillment', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [DEMO_ID_HEADER]: demoId,
      [RUN_ID_HEADER]: runId,
    },
    body: JSON.stringify({ orderId: body.orderId }),
  });

  return c.json({ ok: true });
});

app.post('/internal/fulfillment', async (c) => {
  const demoId = c.req.header(DEMO_ID_HEADER) ?? '';
  const runId = c.req.header(RUN_ID_HEADER) ?? '';
  const body = await c.req.json();

  await emit(demoId, 'fulfillment-service', 'running', { runId });
  await delay();
  await emit(demoId, 'fulfillment-service', 'done', {
    runId,
    payload: { shipmentId: `shp_${Date.now()}`, orderId: body.orderId },
  });

  return c.json({ ok: true });
});

export default {
  port: 3000,
  fetch: app.fetch,
};
