import { createEventBus } from './event-bus.ts';
import { createQueue } from './queue.ts';
import { createServer } from './server.ts';
import { createOrderStore } from './store.ts';
import { startInventoryWorker, startShippingWorker } from './workers.ts';

const PORT = Number(globalThis.process?.env?.ORDER_PIPELINE_PORT ?? 3040);

const bus = createEventBus();
const shipments = createQueue();
const store = createOrderStore();

startInventoryWorker(bus, store);
startShippingWorker(shipments, store);

const app = createServer({ store, bus, shipments });

const server = Bun.serve({ port: PORT, hostname: 'localhost', fetch: app.fetch });

console.log(`order-pipeline listening on http://${server.hostname}:${server.port}`);
console.log('Routes:');
console.log(
  '  POST /orders             → create an order, publish order.created, enqueue shipment',
);
console.log('  GET  /orders             → list orders');
console.log('  GET  /orders/:id         → fetch one order');
console.log('  POST /payments/charge    → mark an order paid (HTTP-call leg)');
console.log('  GET  /admin/stats        → dynamic detail data');
