# Hono hints

## Route shapes to look for

```ts
app.get('/health', (c) => c.text('ok'))
app.post('/orders', async (c) => { ... })
app.route('/v1', subApp)
```

Hono apps frequently chain `app.get(...).post(...).put(...)`. The
`extract-routes.mjs` chained-method regex catches those.

## Bun adapter signature

Hono on Bun usually exports:

```ts
export default { port: PORT, fetch: app.fetch }
```

…which means `bun run src/server.ts` is the dev command. Check for this
shape; if present, Tier 1 confidence is high.

## Listening port

- Often `process.env.PORT ?? <number>` in the export object
- Sometimes hard-coded as `port: 3040`
- Or a `serve()` call from `@hono/node-server` (less common — Bun is preferred)

## Tier notes

- **Tier 1**: Hono on Bun starts in ~50ms and almost never needs external
  deps. Default to recommending Tier 1 unless the route handlers reach into
  Postgres/external APIs.
- **Tier 2**: The mock harness *itself* is a Hono app, so the patterns
  match exactly — harness-author can mirror the user's route signatures.
