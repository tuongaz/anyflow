# Express / Fastify hints

## Route shapes to look for

```js
app.get('/health', handler)
router.post('/orders', ...)
api.put('/orders/:id', ...)
fastify.delete('/orders/:id', ...)
```

The `extract-routes.mjs` regex matches `(app|router|api|server|fastify).<method>(...)` 
and chained `.get()/.post()` calls. The script ignores method calls on objects
named other things (e.g. `someClient.get(...)`) — if the codebase uses an
unusual variable name for the app instance, the agent should suggest those
files explicitly to the wiring-builder.

## Common entry-point patterns

- `src/server.ts` / `src/index.ts` — listens on a port directly
- `src/app.ts` — exports the app, port chosen by a separate `start.ts`
- Fastify often has `await app.ready(); await app.listen({ port })`

## Port detection

Look for `app.listen(<port>)` or `process.env.PORT ?? <number>`. The default
port shows up in:

- `src/server.ts` body
- `package.json` `scripts.dev` (e.g. `PORT=3040 bun run src/server.ts`)
- `Makefile` (e.g. `dev:\n\tPORT=3040 ...`)

## Event/queue idioms

- In-process bus: `bus.publish('order.created')`, `events.emit('user.created')`
- BullMQ: `new Queue('shipments')`, `queue.add(...)`
- Kafka: `producer.send({ topic: 'orders' })`

## Tier notes

- **Tier 1**: Express/Fastify apps usually have a single `dev` script and a
  fixed port. High confidence.
- **Tier 2**: Easy to mock — Hono harness with the same routes returns fake
  JSON.
- **Tier 3**: Fall back here when the app needs Postgres/Redis/etc. and the
  user can't trivially `make dev`.
