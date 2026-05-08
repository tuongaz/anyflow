import { createEventBus } from './event-bus.ts';
import { createServer } from './server.ts';
import { createTodoStore } from './store.ts';
import { startWorker } from './worker.ts';

const PORT = Number(globalThis.process?.env?.TODO_DEMO_PORT ?? 3030);

const bus = createEventBus();
const store = createTodoStore([
  {
    id: 'seed-1',
    title: 'Try AnyDemo',
    completed: false,
    createdAt: Date.now(),
    completedAt: null,
  },
]);

startWorker(bus);

const app = createServer({ store, bus });

const server = Bun.serve({ port: PORT, hostname: '0.0.0.0', fetch: app.fetch });

console.log(`todo-demo-target listening on http://${server.hostname}:${server.port}`);
console.log('Routes:');
console.log('  POST /todos                  → create a todo');
console.log('  GET  /todos                  → list todos');
console.log('  POST /todos/:id/complete     → mark complete + publish event');
console.log('  GET  /admin/stats            → dynamic detail data');
console.log('Seed todo id: seed-1');
