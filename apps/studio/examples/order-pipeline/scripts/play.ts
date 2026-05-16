const demoId = process.env.SEEFLOW_DEMO_ID ?? '';
const runId = process.env.SEEFLOW_RUN_ID ?? '';

const res = await fetch('http://localhost:3000/orders', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-seeflow-demo-id': demoId,
    'x-seeflow-run-id': runId,
  },
  body: JSON.stringify({ customerId: 'cust_123', items: [{ sku: 'WIDGET-1', qty: 2 }] }),
});

if (!res.ok) {
  console.error(`POST /orders failed: ${res.status}`);
  process.exit(1);
}
