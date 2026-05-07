import { Hono } from 'hono';
import type { EventBus } from './event-bus.ts';
import type { TodoStore } from './store.ts';

export interface ServerOptions {
  store: TodoStore;
  bus: EventBus;
}

export function createServer({ store, bus }: ServerOptions): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/todos', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const title =
      typeof (body as { title?: unknown }).title === 'string'
        ? (body as { title: string }).title
        : 'Untitled todo';
    const todo = store.create({ title });
    return c.json(todo, 201);
  });

  app.get('/todos', (c) => c.json(store.list()));

  app.post('/todos/:id/complete', (c) => {
    const id = c.req.param('id');
    const todo = store.complete(id);
    if (!todo) return c.json({ error: `Unknown todo: ${id}` }, 404);
    bus.emit('todo.completed', { todoId: todo.id, completedAt: todo.completedAt ?? Date.now() });
    return c.json(todo);
  });

  app.get('/admin/stats', (c) => c.json(store.stats()));

  return app;
}
