import { describe, expect, it } from 'bun:test';
import { createApp } from './server.ts';

describe('createApp', () => {
  it('GET /health returns { ok: true }', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown route returns 404', async () => {
    const app = createApp({ mode: 'prod', staticRoot: './dist/web' });
    const res = await app.request('/__definitely_not_a_route__');
    expect(res.status).toBe(404);
  });
});
