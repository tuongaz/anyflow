import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventBus } from './events.ts';
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
  connectors: [],
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
  const app = createApp({ mode: 'prod', staticRoot: './dist/web', registry, disableWatcher: true });
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

  it('flags entries whose demo file no longer exists as valid:false', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' });

    rmSync(join(repoPath, '.anydemo', 'demo.json'));

    const list = (await (await app.request('/api/demos')).json()) as Array<{ valid: boolean }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.valid).toBe(false);
  });

  it('rehydrates registered demos after the registry is rebuilt from disk', async () => {
    const registryPath = tmpRegistry();
    const repoA = tmpRepoWithDemo();
    const repoB = tmpRepoWithDemo({ ...VALID_DEMO, name: 'Other Flow' });

    const reg1 = createRegistry({ path: registryPath });
    const app1 = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry: reg1,
      disableWatcher: true,
    });
    await post(app1, '/api/demos/register', { repoPath: repoA, demoPath: '.anydemo/demo.json' });
    await post(app1, '/api/demos/register', { repoPath: repoB, demoPath: '.anydemo/demo.json' });

    const reg2 = createRegistry({ path: registryPath });
    const app2 = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry: reg2,
      disableWatcher: true,
    });
    const list = (await (await app2.request('/api/demos')).json()) as Array<{
      slug: string;
      valid: boolean;
    }>;
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.slug).sort()).toEqual(['checkout-flow', 'other-flow']);
    expect(list.every((e) => e.valid)).toBe(true);
  });
});

describe('GET /api/demos/:id', () => {
  it('returns the validated demo + filePath when watcher is disabled (sync read fallback)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await app.request(`/api/demos/${reg.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      slug: string;
      name: string;
      filePath: string;
      demo: { name: string };
      valid: boolean;
      error: string | null;
    };
    expect(body.valid).toBe(true);
    expect(body.demo.name).toBe('Checkout Flow');
    expect(body.filePath.endsWith('.anydemo/demo.json')).toBe(true);
    expect(body.error).toBeNull();
  });

  it('returns 404 for unknown demo ids', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/demos/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('reports valid:false + error when on-disk JSON is malformed', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    writeFileSync(join(repoPath, '.anydemo', 'demo.json'), '{ broken');

    const res = await app.request(`/api/demos/${reg.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { valid: boolean; error: string | null };
    expect(body.valid).toBe(false);
    expect(body.error).toContain('Invalid JSON');
  });
});

describe('POST /api/demos/:id/play/:nodeId', () => {
  const startStubServer = (
    handler: (req: Request) => Response | Promise<Response>,
  ): { url: string; stop: () => void } => {
    const server = Bun.serve({ port: 0, fetch: handler });
    return {
      url: `http://${server.hostname}:${server.port}`,
      stop: () => server.stop(true),
    };
  };

  const demoWithUrl = (url: string) => ({
    ...VALID_DEMO,
    nodes: [
      {
        ...VALID_DEMO.nodes[0],
        data: {
          ...VALID_DEMO.nodes[0]?.data,
          playAction: {
            kind: 'http',
            method: 'POST',
            url,
            body: { hello: 'world' },
          },
        },
      },
    ],
  });

  it('proxies the request and returns status + JSON body', async () => {
    const stub = startStubServer((req) => {
      expect(req.method).toBe('POST');
      return Response.json({ ok: true, echoed: 42 }, { status: 201 });
    });
    try {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo(demoWithUrl(stub.url));
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const res = await post(app, `/api/demos/${reg.id}/play/api-checkout`, {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { runId: string; status: number; body: unknown };
      expect(typeof body.runId).toBe('string');
      expect(body.status).toBe(201);
      expect(body.body).toEqual({ ok: true, echoed: 42 });
    } finally {
      stub.stop();
    }
  });

  it('broadcasts node:running before the fetch and node:done after', async () => {
    let serverHit = false;
    const stub = startStubServer(() => {
      serverHit = true;
      return Response.json({ ok: true });
    });
    try {
      const bus = createEventBus();
      const registry = createRegistry({ path: tmpRegistry() });
      const app = createApp({
        mode: 'prod',
        staticRoot: './dist/web',
        registry,
        events: bus,
        disableWatcher: true,
      });
      const repoPath = tmpRepoWithDemo(demoWithUrl(stub.url));
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const captured: Array<{ type: string; payload: unknown }> = [];
      bus.subscribe(reg.id, (e) => captured.push({ type: e.type, payload: e.payload }));

      const playRes = await post(app, `/api/demos/${reg.id}/play/api-checkout`, {});
      expect(playRes.status).toBe(200);
      expect(serverHit).toBe(true);

      const types = captured.map((e) => e.type);
      expect(types[0]).toBe('node:running');
      expect(types[types.length - 1]).toBe('node:done');
      const done = captured[captured.length - 1]?.payload as {
        nodeId: string;
        status: number;
        body: unknown;
      };
      expect(done.nodeId).toBe('api-checkout');
      expect(done.status).toBe(200);
    } finally {
      stub.stop();
    }
  });

  it('broadcasts node:error and returns runId + error when the target is unreachable', async () => {
    const { app } = buildApp();
    // Pick a port we know nothing is listening on.
    const repoPath = tmpRepoWithDemo(demoWithUrl('http://127.0.0.1:1'));
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/demos/${reg.id}/play/api-checkout`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; error?: string; status?: number };
    expect(typeof body.runId).toBe('string');
    expect(body.status).toBeUndefined();
    expect(body.error).toBeTruthy();
  });

  it('returns 404 for unknown demoId', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/demos/nope/play/x', {});
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };
    const res = await post(app, `/api/demos/${reg.id}/play/missing`, {});
    expect(res.status).toBe(404);
  });
});

describe('POST /api/demos/:id/nodes/:nodeId/detail', () => {
  const startStubServer = (
    handler: (req: Request) => Response | Promise<Response>,
  ): { url: string; stop: () => void } => {
    const server = Bun.serve({ port: 0, fetch: handler });
    return {
      url: `http://${server.hostname}:${server.port}`,
      stop: () => server.stop(true),
    };
  };

  const demoWithDynamicSource = (url: string) => ({
    ...VALID_DEMO,
    nodes: [
      {
        ...VALID_DEMO.nodes[0],
        data: {
          ...VALID_DEMO.nodes[0]?.data,
          detail: {
            summary: 'Stats',
            dynamicSource: {
              kind: 'http',
              method: 'GET',
              url,
            },
          },
        },
      },
    ],
  });

  it('proxies the dynamicSource request and returns status + body', async () => {
    const stub = startStubServer((req) => {
      expect(req.method).toBe('GET');
      return Response.json({ orders: 12, lastOrderId: 'ord_42' });
    });
    try {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo(demoWithDynamicSource(stub.url));
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const res = await post(app, `/api/demos/${reg.id}/nodes/api-checkout/detail`, {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: number; body: unknown };
      expect(body.status).toBe(200);
      expect(body.body).toEqual({ orders: 12, lastOrderId: 'ord_42' });
    } finally {
      stub.stop();
    }
  });

  it('does not broadcast node:* events when fetching detail', async () => {
    const stub = startStubServer(() => Response.json({ ok: true }));
    try {
      const bus = createEventBus();
      const registry = createRegistry({ path: tmpRegistry() });
      const app = createApp({
        mode: 'prod',
        staticRoot: './dist/web',
        registry,
        events: bus,
        disableWatcher: true,
      });
      const repoPath = tmpRepoWithDemo(demoWithDynamicSource(stub.url));
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const captured: Array<{ type: string }> = [];
      bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

      const res = await post(app, `/api/demos/${reg.id}/nodes/api-checkout/detail`, {});
      expect(res.status).toBe(200);
      const nodeEvents = captured.filter((e) => e.type.startsWith('node:'));
      expect(nodeEvents).toHaveLength(0);
    } finally {
      stub.stop();
    }
  });

  it('returns 404 when the node has no dynamicSource', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/demos/${reg.id}/nodes/api-checkout/detail`, {});
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('dynamicSource');
  });

  it('returns 404 for unknown demoId', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/demos/nope/nodes/x/detail', {});
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };
    const res = await post(app, `/api/demos/${reg.id}/nodes/missing/detail`, {});
    expect(res.status).toBe(404);
  });

  it('returns body.error when the upstream is unreachable', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(demoWithDynamicSource('http://127.0.0.1:1'));
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/demos/${reg.id}/nodes/api-checkout/detail`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: string; status?: number };
    expect(body.status).toBeUndefined();
    expect(body.error).toBeTruthy();
  });
});

describe('POST /api/emit', () => {
  const buildAppWithBus = () => {
    const bus = createEventBus();
    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      events: bus,
      disableWatcher: true,
    });
    return { app, registry, bus };
  };

  it('broadcasts node:running for status=running and returns ok', async () => {
    const { app, bus } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const captured: Array<{ type: string; payload: unknown }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type, payload: e.payload }));

    const res = await post(app, '/api/emit', {
      demoId: reg.id,
      nodeId: 'worker',
      status: 'running',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.type).toBe('node:running');
    expect((captured[0]?.payload as { nodeId: string }).nodeId).toBe('worker');
  });

  it('maps status=done → node:done and merges payload', async () => {
    const { app, bus } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const captured: Array<{ type: string; payload: unknown }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type, payload: e.payload }));

    const res = await post(app, '/api/emit', {
      demoId: reg.id,
      nodeId: 'worker',
      status: 'done',
      runId: 'run-42',
      payload: { status: 200, body: { ok: true } },
    });
    expect(res.status).toBe(200);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.type).toBe('node:done');
    const payload = captured[0]?.payload as {
      nodeId: string;
      runId: string;
      status: number;
      body: unknown;
    };
    expect(payload.nodeId).toBe('worker');
    expect(payload.runId).toBe('run-42');
    expect(payload.status).toBe(200);
    expect(payload.body).toEqual({ ok: true });
  });

  it('maps status=error → node:error', async () => {
    const { app, bus } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const captured: Array<{ type: string }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

    const res = await post(app, '/api/emit', {
      demoId: reg.id,
      nodeId: 'worker',
      status: 'error',
      payload: { message: 'boom' },
    });
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.type).toBe('node:error');
  });

  it('returns 404 when demoId is unknown', async () => {
    const { app } = buildAppWithBus();
    const res = await post(app, '/api/emit', {
      demoId: 'does-not-exist',
      nodeId: 'worker',
      status: 'running',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when status is not one of running|done|error', async () => {
    const { app } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await post(app, '/api/emit', {
      demoId: reg.id,
      nodeId: 'worker',
      status: 'oops',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    const { app } = buildAppWithBus();
    const res = await app.request('/api/emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/events', () => {
  it('returns 400 when demoId is missing', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/events');
    expect(res.status).toBe(400);
  });

  it('returns 404 when demoId is unknown', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/events?demoId=nope');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/demos/:id/nodes/:nodeId/position', () => {
  const patch = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('updates the node position and rewrites the demo file', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');

    const res = await patch(app, `/api/demos/${reg.id}/nodes/api-checkout/position`, {
      x: 250,
      y: 320,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; position: { x: number; y: number } };
    expect(body.ok).toBe(true);
    expect(body.position).toEqual({ x: 250, y: 320 });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
    };
    expect(onDisk.nodes[0]?.position).toEqual({ x: 250, y: 320 });
  });

  it('preserves 2-space indent and trailing newline (clean editor diffs)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    await patch(app, `/api/demos/${reg.id}/nodes/api-checkout/position`, { x: 1, y: 2 });

    const text = readFileSync(demoFile, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    // Top-level "version" line should be indented with 2 spaces.
    expect(text).toMatch(/^\{\n {2}"version": 1,/);
  });

  it('returns 404 for unknown demoId', async () => {
    const { app } = buildApp();
    const res = await patch(app, '/api/demos/nope/nodes/x/position', { x: 0, y: 0 });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };
    const res = await patch(app, `/api/demos/${reg.id}/nodes/missing/position`, { x: 0, y: 0 });
    expect(res.status).toBe(404);
  });

  it('returns 400 when x or y is non-numeric', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };
    const res = await patch(app, `/api/demos/${reg.id}/nodes/api-checkout/position`, {
      x: 'oops',
      y: 0,
    });
    expect(res.status).toBe(400);
  });

  it('writes via tempfile + rename (no .tmp residue, preserves content on success)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const dir = join(repoPath, '.anydemo');
    await patch(app, `/api/demos/${reg.id}/nodes/api-checkout/position`, { x: 99, y: 99 });

    const files = readdirSync(dir);
    // Only demo.json should remain — temp files must be renamed/cleaned up.
    expect(files).toEqual(['demo.json']);
  });
});

describe('PATCH /api/demos/:id/nodes/:nodeId', () => {
  const patch = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('merges a partial update into node.data and rewrites the demo file', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');

    const res = await patch(app, `/api/demos/${reg.id}/nodes/api-checkout`, {
      label: 'POST /checkout (renamed)',
      borderColor: 'blue',
      backgroundColor: 'amber',
      width: 240,
      height: 120,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{
        id: string;
        position: { x: number; y: number };
        data: {
          label: string;
          borderColor?: string;
          backgroundColor?: string;
          width?: number;
          height?: number;
          playAction: { kind: string };
        };
      }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.label).toBe('POST /checkout (renamed)');
    expect(node?.data.borderColor).toBe('blue');
    expect(node?.data.backgroundColor).toBe('amber');
    expect(node?.data.width).toBe(240);
    expect(node?.data.height).toBe(120);
    // Untouched fields are preserved.
    expect(node?.data.playAction.kind).toBe('http');
    expect(node?.position).toEqual({ x: 0, y: 0 });
  });

  it('updates node.position when included in the patch body', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const res = await patch(app, `/api/demos/${reg.id}/nodes/api-checkout`, {
      position: { x: 42, y: 84 },
    });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
    };
    expect(onDisk.nodes[0]?.position).toEqual({ x: 42, y: 84 });
  });

  it('returns 400 with issues when the patched demo would fail schema validation', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const before = readFileSync(demoFile, 'utf8');

    // borderColor token outside the enum — the body schema itself should reject this.
    const res = await patch(app, `/api/demos/${reg.id}/nodes/api-checkout`, {
      borderColor: 'neon-pink',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toBeTruthy();

    // The file must NOT have been touched on validation failure.
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 400 when the resulting demo violates DemoSchema (empty label on functional node)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await patch(app, `/api/demos/${reg.id}/nodes/api-checkout`, { label: '' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toContain('schema');

    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 400 when the body has an unknown top-level key', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await patch(app, `/api/demos/${reg.id}/nodes/api-checkout`, {
      somethingMadeUp: true,
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown demoId', async () => {
    const { app } = buildApp();
    const res = await patch(app, '/api/demos/nope/nodes/x', { label: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };
    const res = await patch(app, `/api/demos/${reg.id}/nodes/missing`, { label: 'x' });
    expect(res.status).toBe(404);
  });

  it('preserves 2-space indent + trailing newline on rewrite', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    await patch(app, `/api/demos/${reg.id}/nodes/api-checkout`, { label: 'Renamed' });

    const text = readFileSync(demoFile, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toMatch(/^\{\n {2}"version": 1,/);
  });
});

describe('POST /api/demos/:id/nodes', () => {
  it('appends a new node and auto-generates an id when absent', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');

    const res = await post(app, `/api/demos/${reg.id}/nodes`, {
      type: 'shapeNode',
      position: { x: 100, y: 200 },
      data: { shape: 'rectangle', label: 'Note A' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^node-/);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; type: string }>;
    };
    expect(onDisk.nodes).toHaveLength(2);
    const created = onDisk.nodes.find((n) => n.id === body.id);
    expect(created?.type).toBe('shapeNode');
  });

  it('honors a caller-provided id when given', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/demos/${reg.id}/nodes`, {
      id: 'sticky-note-1',
      type: 'shapeNode',
      position: { x: 0, y: 0 },
      data: { shape: 'sticky' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('sticky-note-1');
  });

  it('returns 400 with schema issues when the new node is malformed', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const before = readFileSync(demoFile, 'utf8');

    // type 'shapeNode' but missing required `shape`.
    const res = await post(app, `/api/demos/${reg.id}/nodes`, {
      type: 'shapeNode',
      position: { x: 0, y: 0 },
      data: {},
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toContain('schema');

    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 404 for unknown demoId', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/demos/nope/nodes', {
      type: 'shapeNode',
      position: { x: 0, y: 0 },
      data: { shape: 'rectangle' },
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/demos/:id/nodes/:nodeId', () => {
  const VALID_DEMO_TWO_NODES = {
    version: 1,
    name: 'Two Nodes',
    nodes: [
      {
        id: 'a',
        type: 'playNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'A',
          kind: 'service',
          stateSource: { kind: 'request' },
          playAction: { kind: 'http', method: 'POST', url: 'http://example.test/a' },
        },
      },
      {
        id: 'b',
        type: 'playNode',
        position: { x: 200, y: 0 },
        data: {
          label: 'B',
          kind: 'service',
          stateSource: { kind: 'request' },
          playAction: { kind: 'http', method: 'POST', url: 'http://example.test/b' },
        },
      },
    ],
    connectors: [
      { id: 'a-to-b', source: 'a', target: 'b', kind: 'default' },
      { id: 'b-to-a', source: 'b', target: 'a', kind: 'default' },
    ],
  };

  it('removes the node and cascades adjacent connectors in one write', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');

    const res = await app.request(`/api/demos/${reg.id}/nodes/a`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string }>;
      connectors: Array<{ id: string; source: string; target: string }>;
    };
    expect(onDisk.nodes.map((n) => n.id)).toEqual(['b']);
    // Both connectors referenced node 'a' as source or target — both removed.
    expect(onDisk.connectors).toEqual([]);
  });

  it('leaves connectors that do not reference the deleted node untouched', async () => {
    const demo = {
      ...VALID_DEMO_TWO_NODES,
      nodes: [
        ...VALID_DEMO_TWO_NODES.nodes,
        {
          id: 'c',
          type: 'playNode',
          position: { x: 400, y: 0 },
          data: {
            label: 'C',
            kind: 'service',
            stateSource: { kind: 'request' },
            playAction: { kind: 'http', method: 'POST', url: 'http://example.test/c' },
          },
        },
      ],
      connectors: [
        { id: 'a-to-b', source: 'a', target: 'b', kind: 'default' },
        { id: 'b-to-c', source: 'b', target: 'c', kind: 'default' },
      ],
    };
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(demo);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const res = await app.request(`/api/demos/${reg.id}/nodes/a`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string }>;
      connectors: Array<{ id: string }>;
    };
    expect(onDisk.nodes.map((n) => n.id).sort()).toEqual(['b', 'c']);
    // a-to-b is gone (source==a); b-to-c stays.
    expect(onDisk.connectors.map((c) => c.id)).toEqual(['b-to-c']);
  });

  it('returns 404 for unknown demoId', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/demos/nope/nodes/x', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };
    const res = await app.request(`/api/demos/${reg.id}/nodes/missing`, { method: 'DELETE' });
    expect(res.status).toBe(404);
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
