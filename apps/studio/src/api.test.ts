import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry } from './registry.ts';
import { createApp } from './server.ts';

const VALID_DEMO = {
  version: 1,
  name: 'Checkout Flow',
  nodes: [
    {
      id: 'api-checkout',
      type: 'playNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'POST /checkout',
        kind: 'service',
        stateSource: { kind: 'request' },
        playAction: {
          kind: 'http',
          method: 'POST',
          url: 'http://localhost:3001/checkout',
        },
      },
    },
  ],
  edges: [],
};

const tmpRegistry = () => {
  const dir = mkdtempSync(join(tmpdir(), 'anydemo-api-reg-'));
  return join(dir, 'registry.json');
};

const tmpRepoWithDemo = (demo: unknown = VALID_DEMO) => {
  const repoDir = mkdtempSync(join(tmpdir(), 'anydemo-api-repo-'));
  mkdirSync(join(repoDir, '.anydemo'));
  writeFileSync(join(repoDir, '.anydemo', 'demo.json'), JSON.stringify(demo));
  return repoDir;
};

const buildApp = () => {
  const registry = createRegistry({ path: tmpRegistry() });
  const app = createApp({ mode: 'prod', staticRoot: './dist/web', registry });
  return { app, registry };
};

const post = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/demos/register', () => {
  it('registers a valid demo and returns id + slug', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();

    const res = await post(app, '/api/demos/register', {
      name: 'Checkout Flow',
      repoPath,
      demoPath: '.anydemo/demo.json',
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; slug: string };
    expect(json.slug).toBe('checkout-flow');
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.id).toBe(json.id);
  });

  it('returns 400 with Zod issues when the demo file fails schema validation', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo({ version: 1 });

    const res = await post(app, '/api/demos/register', {
      name: 'Bad demo',
      repoPath,
      demoPath: '.anydemo/demo.json',
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; issues?: Array<{ path: unknown[] }> };
    expect(json.error).toContain('schema validation');
    expect(json.issues?.length ?? 0).toBeGreaterThan(0);
    expect(registry.list()).toHaveLength(0);
  });

  it('returns 400 when the demo file does not exist', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/demos/register', {
      name: 'Missing',
      repoPath: '/this/path/does/not/exist',
      demoPath: '.anydemo/demo.json',
    });
    expect(res.status).toBe(400);
  });

  it('re-registering the same repoPath updates in place (same id, same slug)', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();

    const first = await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json();
    const second = await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json();

    expect((second as { id: string }).id).toBe((first as { id: string }).id);
    expect((second as { slug: string }).slug).toBe((first as { slug: string }).slug);
    expect(registry.list()).toHaveLength(1);
  });
});

describe('GET /api/demos', () => {
  it('returns the registry list as summaries', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' });

    const res = await app.request('/api/demos');
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{
      id: string;
      slug: string;
      name: string;
      repoPath: string;
      lastModified: number;
      valid: boolean;
    }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe('checkout-flow');
    expect(list[0]?.name).toBe('Checkout Flow');
    expect(list[0]?.valid).toBe(true);
  });
});

describe('DELETE /api/demos/:id', () => {
  it('removes the entry and returns ok', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await app.request(`/api/demos/${reg.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(registry.list()).toHaveLength(0);
  });

  it('returns 404 for unknown ids', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/demos/does-not-exist', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
