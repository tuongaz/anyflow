import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
  it('registers a valid demo and returns id + slug + skipped sdk for request-only demo', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();

    const res = await post(app, '/api/demos/register', {
      name: 'Checkout Flow',
      repoPath,
      demoPath: '.anydemo/demo.json',
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      id: string;
      slug: string;
      sdk: { outcome: string; filePath: string | null };
    };
    expect(json.slug).toBe('checkout-flow');
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.id).toBe(json.id);
    expect(json.sdk).toEqual({ outcome: 'skipped', filePath: null });
  });

  it('writes .anydemo/sdk/emit.ts when the demo declares an event-bound state node', async () => {
    const { app } = buildApp();
    const eventDemo = {
      version: 1,
      name: 'Event Flow',
      nodes: [
        {
          id: 'queue-orders',
          type: 'stateNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'orders.created',
            kind: 'queue',
            stateSource: { kind: 'event' },
          },
        },
      ],
      connectors: [],
    };
    const repoPath = tmpRepoWithDemo(eventDemo);

    const res = await post(app, '/api/demos/register', {
      repoPath,
      demoPath: '.anydemo/demo.json',
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      sdk: { outcome: string; filePath: string | null };
    };
    expect(json.sdk.outcome).toBe('written');
    expect(json.sdk.filePath).toBe(join(repoPath, '.anydemo', 'sdk', 'emit.ts'));
    const written = readFileSync(join(repoPath, '.anydemo', 'sdk', 'emit.ts'), 'utf8');
    expect(written.length).toBeGreaterThan(0);

    const second = await post(app, '/api/demos/register', {
      repoPath,
      demoPath: '.anydemo/demo.json',
    });
    const secondJson = (await second.json()) as { sdk: { outcome: string } };
    expect(secondJson.sdk.outcome).toBe('present');
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

describe('POST /api/demos/validate', () => {
  it('returns ok:true with zero issues for a valid static demo', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/demos/validate', { demo: VALID_DEMO, tier: 'static' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      issues: unknown[];
      warnings: unknown[];
      stats: { tier: string; nodeCount: number };
    };
    expect(json.ok).toBe(true);
    expect(json.issues).toHaveLength(0);
    expect(json.stats.tier).toBe('static');
    expect(json.stats.nodeCount).toBe(1);
  });

  it('returns Zod issues for a malformed demo', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/demos/validate', { demo: { version: 1 } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; issues: Array<{ kind: string }> };
    expect(json.ok).toBe(false);
    expect(json.issues.some((i) => i.kind === 'zod')).toBe(true);
  });

  it('flags tier-mismatch when tier=real but no playable nodes exist', async () => {
    const { app } = buildApp();
    const staticOnly = {
      version: 1,
      name: 'Static only',
      nodes: [
        {
          id: 'box',
          type: 'shapeNode',
          position: { x: 0, y: 0 },
          data: { shape: 'rectangle' },
        },
      ],
      connectors: [],
    };
    const res = await post(app, '/api/demos/validate', { demo: staticOnly, tier: 'real' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; issues: Array<{ kind: string }> };
    expect(json.ok).toBe(false);
    expect(json.issues.some((i) => i.kind === 'tier-mismatch')).toBe(true);
  });

  it('flags cap issue when node count exceeds 30', async () => {
    const { app } = buildApp();
    const bigDemo = {
      version: 1,
      name: 'Too big',
      nodes: Array.from({ length: 31 }, (_, i) => ({
        id: `n${i}`,
        type: 'shapeNode',
        position: { x: 0, y: 0 },
        data: { shape: 'rectangle' as const },
      })),
      connectors: [],
    };
    const res = await post(app, '/api/demos/validate', { demo: bigDemo, tier: 'static' });
    const json = (await res.json()) as { issues: Array<{ kind: string }> };
    expect(json.issues.some((i) => i.kind === 'cap')).toBe(true);
  });

  it('warns about reachability for tier=real with http playActions', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/demos/validate', { demo: VALID_DEMO, tier: 'real' });
    const json = (await res.json()) as { warnings: Array<{ kind: string }> };
    expect(json.warnings.some((w) => w.kind === 'real-tier-reachability')).toBe(true);
  });

  it('returns 400 for malformed JSON body', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/demos/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/diagram/propose-scope', () => {
  it('returns ranked entry-point candidates from a scan-result-shaped body', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/propose-scope', {
      files: [
        { path: 'src/server.ts', category: 'code' },
        { path: 'src/lib/helper.ts', category: 'code' },
        { path: 'README.md', category: 'docs' },
        { path: 'node_modules/foo/index.js', category: 'code' },
      ],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      candidates: Array<{ path: string; score: number; reasons: string[] }>;
    };
    expect(json.candidates.length).toBeGreaterThan(0);
    expect(json.candidates[0]?.path).toBe('src/server.ts');
    expect(json.candidates.some((c) => c.path.includes('node_modules'))).toBe(false);
  });

  it('returns empty candidates when there are no code files', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/propose-scope', {
      files: [{ path: 'README.md', category: 'docs' }],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { candidates: unknown[] };
    expect(json.candidates).toHaveLength(0);
  });

  it('returns 400 when files is missing', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/propose-scope', {});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/diagram/assemble', () => {
  it('assembles wiring + layout into a demo with snapped positions and stats', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/assemble', {
      wiring: {
        name: 'Test Demo',
        nodes: [
          {
            id: 'API',
            type: 'playNode',
            position: { x: 11, y: 23 },
            data: {
              label: 'API',
              kind: 'service',
              stateSource: { kind: 'request' },
              playAction: { kind: 'http', method: 'GET', url: 'http://x/y' },
            },
          },
          {
            id: 'db',
            type: 'stateNode',
            position: { x: 100, y: 100 },
            data: { label: 'DB', kind: 'store', stateSource: { kind: 'request' } },
          },
        ],
        connectors: [
          { id: 'a-b', source: 'API', target: 'db', kind: 'http' },
          { source: 'ghost', target: 'db', kind: 'http' },
        ],
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      demo: {
        name: string;
        nodes: Array<{ id: string; position: { x: number; y: number } }>;
        connectors: unknown[];
      };
      stats: { danglingConnectorsDropped: number; positionsSnapped: number };
    };
    expect(json.demo.name).toBe('Test Demo');
    expect(json.demo.nodes.map((n) => n.id)).toEqual(['api', 'db']);
    const firstPos = json.demo.nodes[0]?.position;
    expect(firstPos).toBeDefined();
    expect((firstPos?.x ?? -1) % 24).toBe(0);
    expect((firstPos?.y ?? -1) % 24).toBe(0);
    expect(json.stats.danglingConnectorsDropped).toBe(1);
    expect(json.stats.positionsSnapped).toBeGreaterThan(0);
  });

  it('applies layout positions to override wiring positions', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/assemble', {
      wiring: {
        nodes: [{ id: 'n1', position: { x: 0, y: 0 } }],
        connectors: [],
      },
      layout: { positions: { n1: { x: 240, y: 480 } } },
    });
    const json = (await res.json()) as {
      demo: { nodes: Array<{ id: string; position: { x: number; y: number } }> };
    };
    expect(json.demo.nodes[0]?.position).toEqual({ x: 240, y: 480 });
  });

  it('returns 400 for missing wiring', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/assemble', { layout: { positions: {} } });
    expect(res.status).toBe(400);
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

describe('POST /api/demos/:id/reset', () => {
  const startStubServer = (
    handler: (req: Request) => Response | Promise<Response>,
  ): { url: string; stop: () => void } => {
    const server = Bun.serve({ port: 0, fetch: handler });
    return {
      url: `http://${server.hostname}:${server.port}`,
      stop: () => server.stop(true),
    };
  };

  const demoWithResetAction = (action: { method: string; url: string; body?: unknown }) => ({
    ...VALID_DEMO,
    resetAction: { kind: 'http', ...action },
  });

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

  it('returns 200 and broadcasts demo:reload when the demo has no resetAction', async () => {
    const { app, bus } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const captured: Array<{ type: string }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

    const res = await post(app, `/api/demos/${reg.id}/reset`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; calledResetAction: boolean };
    expect(body.ok).toBe(true);
    expect(body.calledResetAction).toBe(false);

    expect(captured.map((e) => e.type)).toEqual(['demo:reload']);
  });

  it('fires the resetAction with method+url+body and broadcasts demo:reload', async () => {
    let receivedMethod: string | undefined;
    let receivedPath: string | undefined;
    let receivedBody: string | undefined;
    let receivedContentType: string | null | undefined;
    const stub = startStubServer(async (req) => {
      receivedMethod = req.method;
      receivedPath = new URL(req.url).pathname;
      receivedContentType = req.headers.get('content-type');
      receivedBody = await req.text();
      return Response.json({ ok: true });
    });
    try {
      const { app, bus } = buildAppWithBus();
      const repoPath = tmpRepoWithDemo(
        demoWithResetAction({
          method: 'POST',
          url: `${stub.url}/reset`,
          body: { fresh: true },
        }),
      );
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const captured: Array<{ type: string }> = [];
      bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

      const res = await post(app, `/api/demos/${reg.id}/reset`, {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; calledResetAction: boolean };
      expect(body.ok).toBe(true);
      expect(body.calledResetAction).toBe(true);

      expect(receivedMethod).toBe('POST');
      expect(receivedPath).toBe('/reset');
      expect(receivedContentType).toContain('application/json');
      expect(JSON.parse(receivedBody ?? '')).toEqual({ fresh: true });

      expect(captured.map((e) => e.type)).toEqual(['demo:reload']);
    } finally {
      stub.stop();
    }
  });

  it('returns 502 but still broadcasts demo:reload when the resetAction returns 500', async () => {
    const stub = startStubServer(() => new Response('boom', { status: 500 }));
    try {
      const { app, bus } = buildAppWithBus();
      const repoPath = tmpRepoWithDemo(
        demoWithResetAction({ method: 'POST', url: `${stub.url}/reset` }),
      );
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const captured: Array<{ type: string }> = [];
      bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

      const res = await post(app, `/api/demos/${reg.id}/reset`, {});
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string; calledResetAction: boolean };
      expect(body.calledResetAction).toBe(true);
      expect(body.error).toContain('500');

      expect(captured.map((e) => e.type)).toEqual(['demo:reload']);
    } finally {
      stub.stop();
    }
  });

  it('returns 404 for an unknown demoId', async () => {
    const { app } = buildAppWithBus();
    const res = await post(app, '/api/demos/does-not-exist/reset', {});
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

describe('PATCH /api/demos/:id/nodes/:nodeId/order', () => {
  const VALID_DEMO_THREE_NODES = {
    version: 1,
    name: 'Three Nodes',
    nodes: [
      {
        id: 'a',
        type: 'shapeNode',
        position: { x: 0, y: 0 },
        data: { shape: 'rectangle' },
      },
      {
        id: 'b',
        type: 'shapeNode',
        position: { x: 100, y: 0 },
        data: { shape: 'rectangle' },
      },
      {
        id: 'c',
        type: 'shapeNode',
        position: { x: 200, y: 0 },
        data: { shape: 'rectangle' },
      },
    ],
    connectors: [],
  };

  const patch = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const ids = (path: string) =>
    (JSON.parse(readFileSync(path, 'utf8')) as { nodes: Array<{ id: string }> }).nodes.map(
      (n) => n.id,
    );

  const setup = async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_THREE_NODES);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };
    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    return { app, demoFile, demoId: reg.id };
  };

  it("op:'forward' swaps with the next neighbour", async () => {
    const { app, demoFile, demoId } = await setup();
    const res = await patch(app, `/api/demos/${demoId}/nodes/a/order`, { op: 'forward' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['b', 'a', 'c']);
  });

  it("op:'forward' on the topmost node is a no-op", async () => {
    const { app, demoFile, demoId } = await setup();
    const res = await patch(app, `/api/demos/${demoId}/nodes/c/order`, { op: 'forward' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['a', 'b', 'c']);
  });

  it("op:'backward' swaps with the previous neighbour", async () => {
    const { app, demoFile, demoId } = await setup();
    const res = await patch(app, `/api/demos/${demoId}/nodes/c/order`, { op: 'backward' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['a', 'c', 'b']);
  });

  it("op:'backward' on the bottommost node is a no-op", async () => {
    const { app, demoFile, demoId } = await setup();
    const res = await patch(app, `/api/demos/${demoId}/nodes/a/order`, { op: 'backward' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['a', 'b', 'c']);
  });

  it("op:'toFront' moves to the end of the array", async () => {
    const { app, demoFile, demoId } = await setup();
    const res = await patch(app, `/api/demos/${demoId}/nodes/a/order`, { op: 'toFront' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['b', 'c', 'a']);
  });

  it("op:'toBack' moves to the start of the array", async () => {
    const { app, demoFile, demoId } = await setup();
    const res = await patch(app, `/api/demos/${demoId}/nodes/c/order`, { op: 'toBack' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['c', 'a', 'b']);
  });

  it("op:'toIndex' pins to an absolute index (used by undo)", async () => {
    const { app, demoFile, demoId } = await setup();
    // Move 'a' (idx 0) to idx 2 — same as toFront on a 3-node array.
    const res = await patch(app, `/api/demos/${demoId}/nodes/a/order`, { op: 'toIndex', index: 2 });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['b', 'c', 'a']);

    // Then pin it back to idx 0 — exact inverse.
    const res2 = await patch(app, `/api/demos/${demoId}/nodes/a/order`, {
      op: 'toIndex',
      index: 0,
    });
    expect(res2.status).toBe(200);
    expect(ids(demoFile)).toEqual(['a', 'b', 'c']);
  });

  it("op:'toIndex' clamps out-of-range indices", async () => {
    const { app, demoFile, demoId } = await setup();
    const res = await patch(app, `/api/demos/${demoId}/nodes/a/order`, {
      op: 'toIndex',
      index: 99,
    });
    expect(res.status).toBe(200);
    // Clamped to length-1 = 2 → same as toFront.
    expect(ids(demoFile)).toEqual(['b', 'c', 'a']);
  });

  it('returns 400 for an unknown op', async () => {
    const { app, demoFile, demoId } = await setup();
    const res = await patch(app, `/api/demos/${demoId}/nodes/a/order`, { op: 'noSuchOp' });
    expect(res.status).toBe(400);
    expect(ids(demoFile)).toEqual(['a', 'b', 'c']);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app, demoId } = await setup();
    const res = await patch(app, `/api/demos/${demoId}/nodes/missing/order`, { op: 'forward' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown demoId', async () => {
    const { app } = buildApp();
    const res = await patch(app, '/api/demos/nope/nodes/a/order', { op: 'forward' });
    expect(res.status).toBe(404);
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

  // US-011 (text-and-group-resize): both metadata fields land at the top
  // level of node.data and round-trip through DemoSchema unchanged. Empty
  // string on either field is the documented clear-on-serialize signal —
  // mergeNodeUpdates strips the key so the on-disk demo stays compact.
  it('persists shortDescription + description fields to data on patch', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const res = await patch(app, `/api/demos/${reg.id}/nodes/api-checkout`, {
      shortDescription: 'a caption',
      description: 'multi-line\nnotes about the node',
    });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { shortDescription?: string; description?: string } }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.shortDescription).toBe('a caption');
    expect(node?.data.description).toBe('multi-line\nnotes about the node');
  });

  it('strips shortDescription / description on disk when empty string is patched', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    // First set both fields, then clear them with empty strings.
    await patch(app, `/api/demos/${reg.id}/nodes/api-checkout`, {
      shortDescription: 'tmp',
      description: 'tmp notes',
    });
    const res = await patch(app, `/api/demos/${reg.id}/nodes/api-checkout`, {
      shortDescription: '',
      description: '',
    });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.shortDescription).toBeUndefined();
    expect(node?.data.description).toBeUndefined();
    expect('shortDescription' in (node?.data ?? {})).toBe(false);
    expect('description' in (node?.data ?? {})).toBe(false);
  });

  it('rejects shortDescription longer than 200 characters at the body schema', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const tooLong = 'x'.repeat(201);
    const res = await patch(app, `/api/demos/${reg.id}/nodes/api-checkout`, {
      shortDescription: tooLong,
    });
    expect(res.status).toBe(400);
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

  // US-015: when an htmlNode is drop-created without a client-supplied htmlPath,
  // the backend allocates `blocks/<id>.html`, writes the starter file with the
  // 'Edit me' card markup, and persists the path on the node.
  describe('htmlNode starter-file (US-015)', () => {
    it('writes blocks/<id>.html with starter content and persists htmlPath', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const res = await post(app, `/api/demos/${reg.id}/nodes`, {
        type: 'htmlNode',
        position: { x: 50, y: 60 },
        data: {},
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        id: string;
        node: { type: string; data: { htmlPath: string } };
      };
      expect(body.ok).toBe(true);
      expect(body.id).toMatch(/^node-/);
      expect(body.node.type).toBe('htmlNode');
      expect(body.node.data.htmlPath).toBe(`blocks/${body.id}.html`);

      const starter = readFileSync(join(repoPath, '.anydemo', 'blocks', `${body.id}.html`), 'utf8');
      expect(starter).toContain('Edit me');
      expect(starter).toContain(`blocks/${body.id}.html`);
      expect(starter).toContain('class="text-center"');

      const onDisk = JSON.parse(readFileSync(join(repoPath, '.anydemo', 'demo.json'), 'utf8')) as {
        nodes: Array<{ id: string; type: string; data: { htmlPath?: string } }>;
      };
      const persisted = onDisk.nodes.find((n) => n.id === body.id);
      expect(persisted?.type).toBe('htmlNode');
      expect(persisted?.data.htmlPath).toBe(`blocks/${body.id}.html`);
    });

    it('respects caller-provided id when allocating blocks/<id>.html', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const res = await post(app, `/api/demos/${reg.id}/nodes`, {
        id: 'hero-block',
        type: 'htmlNode',
        position: { x: 0, y: 0 },
        data: {},
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; node: { data: { htmlPath: string } } };
      expect(body.id).toBe('hero-block');
      expect(body.node.data.htmlPath).toBe('blocks/hero-block.html');

      const starter = readFileSync(join(repoPath, '.anydemo', 'blocks', 'hero-block.html'), 'utf8');
      expect(starter).toContain('blocks/hero-block.html');
    });

    it('preserves a client-supplied htmlPath and skips the starter file', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const res = await post(app, `/api/demos/${reg.id}/nodes`, {
        type: 'htmlNode',
        position: { x: 0, y: 0 },
        data: { htmlPath: 'custom/hero.html' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; node: { data: { htmlPath: string } } };
      expect(body.node.data.htmlPath).toBe('custom/hero.html');

      // No starter file should have been written under blocks/.
      const blocksDir = join(repoPath, '.anydemo', 'blocks');
      let blocksExists = true;
      try {
        readdirSync(blocksDir);
      } catch {
        blocksExists = false;
      }
      expect(blocksExists).toBe(false);
    });

    it('preserves other data fields when filling in htmlPath', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const res = await post(app, `/api/demos/${reg.id}/nodes`, {
        type: 'htmlNode',
        position: { x: 0, y: 0 },
        data: { label: 'Pricing card', width: 280, height: 160 },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: string;
        node: { data: { htmlPath: string; label: string; width: number; height: number } };
      };
      expect(body.node.data.label).toBe('Pricing card');
      expect(body.node.data.width).toBe(280);
      expect(body.node.data.height).toBe(160);
      expect(body.node.data.htmlPath).toBe(`blocks/${body.id}.html`);
    });
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

  describe('htmlNode managed file delete (US-016)', () => {
    it('removes blocks/<id>.html when the htmlPath matches the studio-managed shape', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const created = (await (
        await post(app, `/api/demos/${reg.id}/nodes`, {
          type: 'htmlNode',
          position: { x: 0, y: 0 },
          data: {},
        })
      ).json()) as { id: string; node: { data: { htmlPath: string } } };
      const blockFile = join(repoPath, '.anydemo', 'blocks', `${created.id}.html`);
      expect(existsSync(blockFile)).toBe(true);

      const res = await app.request(`/api/demos/${reg.id}/nodes/${created.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(existsSync(blockFile)).toBe(false);

      const onDisk = JSON.parse(readFileSync(join(repoPath, '.anydemo', 'demo.json'), 'utf8')) as {
        nodes: Array<{ id: string }>;
      };
      expect(onDisk.nodes.find((n) => n.id === created.id)).toBeUndefined();
    });

    it('leaves a hand-edited htmlPath file alone when the path does not match blocks/<id>.html', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const customDir = join(repoPath, '.anydemo', 'custom');
      mkdirSync(customDir, { recursive: true });
      const customFile = join(customDir, 'hero.html');
      writeFileSync(customFile, '<div>hand-edited</div>');

      const created = (await (
        await post(app, `/api/demos/${reg.id}/nodes`, {
          type: 'htmlNode',
          position: { x: 0, y: 0 },
          data: { htmlPath: 'custom/hero.html' },
        })
      ).json()) as { id: string; node: { data: { htmlPath: string } } };
      expect(created.node.data.htmlPath).toBe('custom/hero.html');

      const res = await app.request(`/api/demos/${reg.id}/nodes/${created.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(existsSync(customFile)).toBe(true);
      expect(readFileSync(customFile, 'utf8')).toBe('<div>hand-edited</div>');
    });

    it('soft-fails when the managed file is already missing', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const created = (await (
        await post(app, `/api/demos/${reg.id}/nodes`, {
          type: 'htmlNode',
          position: { x: 0, y: 0 },
          data: {},
        })
      ).json()) as { id: string };
      const blockFile = join(repoPath, '.anydemo', 'blocks', `${created.id}.html`);
      unlinkSync(blockFile);
      expect(existsSync(blockFile)).toBe(false);

      const res = await app.request(`/api/demos/${reg.id}/nodes/${created.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const onDisk = JSON.parse(readFileSync(join(repoPath, '.anydemo', 'demo.json'), 'utf8')) as {
        nodes: Array<{ id: string }>;
      };
      expect(onDisk.nodes.find((n) => n.id === created.id)).toBeUndefined();
    });

    it('does not touch other htmlNode-shaped files in blocks/ when an unrelated node is deleted', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
      ).json()) as { id: string };

      const first = (await (
        await post(app, `/api/demos/${reg.id}/nodes`, {
          type: 'htmlNode',
          position: { x: 0, y: 0 },
          data: {},
        })
      ).json()) as { id: string };
      const second = (await (
        await post(app, `/api/demos/${reg.id}/nodes`, {
          type: 'htmlNode',
          position: { x: 80, y: 80 },
          data: {},
        })
      ).json()) as { id: string };
      const firstFile = join(repoPath, '.anydemo', 'blocks', `${first.id}.html`);
      const secondFile = join(repoPath, '.anydemo', 'blocks', `${second.id}.html`);
      expect(existsSync(firstFile)).toBe(true);
      expect(existsSync(secondFile)).toBe(true);

      const res = await app.request(`/api/demos/${reg.id}/nodes/${first.id}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(existsSync(firstFile)).toBe(false);
      expect(existsSync(secondFile)).toBe(true);
    });
  });
});

describe('PATCH /api/demos/:id/connectors/:connId', () => {
  const VALID_DEMO_WITH_CONN = {
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
    connectors: [{ id: 'a-to-b', source: 'a', target: 'b', kind: 'default', label: 'flow' }],
  };

  const patch = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('merges visual fields into the connector and rewrites the demo', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const res = await patch(app, `/api/demos/${reg.id}/connectors/a-to-b`, {
      label: 'renamed',
      style: 'dashed',
      color: 'blue',
      direction: 'both',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{
        id: string;
        kind: string;
        label?: string;
        style?: string;
        color?: string;
        direction?: string;
      }>;
    };
    const conn = onDisk.connectors.find((c) => c.id === 'a-to-b');
    expect(conn?.label).toBe('renamed');
    expect(conn?.style).toBe('dashed');
    expect(conn?.color).toBe('blue');
    expect(conn?.direction).toBe('both');
    expect(conn?.kind).toBe('default');
  });

  it('changes kind and clears stale kind-specific fields from the previous kind', async () => {
    const demo = {
      ...VALID_DEMO_WITH_CONN,
      connectors: [
        {
          id: 'a-to-b',
          source: 'a',
          target: 'b',
          kind: 'event',
          eventName: 'OrderPlaced',
        },
      ],
    };
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(demo);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const res = await patch(app, `/api/demos/${reg.id}/connectors/a-to-b`, { kind: 'default' });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<Record<string, unknown>>;
    };
    const conn = onDisk.connectors.find((c) => c.id === 'a-to-b');
    expect(conn?.kind).toBe('default');
    // Stale 'eventName' from the previous kind must be removed.
    expect(conn?.eventName).toBeUndefined();
  });

  it('returns 400 with schema issues when the resulting connector is invalid', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const before = readFileSync(demoFile, 'utf8');

    // Switching to 'event' without supplying the required eventName is a
    // schema violation surfaced by the post-mutation DemoSchema parse.
    const res = await patch(app, `/api/demos/${reg.id}/connectors/a-to-b`, { kind: 'event' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toContain('schema');
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 400 when the body has an unknown top-level key', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await patch(app, `/api/demos/${reg.id}/connectors/a-to-b`, {
      somethingMadeUp: true,
    });
    expect(res.status).toBe(400);
  });

  // US-022: handle ids on a connector must match the role's allowed sides.
  // Source-side handles are 'r'/'b'; target-side are 't'/'l'. Anything else
  // is a stranded endpoint at render time, so the API rejects it.
  it("accepts a valid sourceHandle ('r') / targetHandle ('t')", async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const res = await patch(app, `/api/demos/${reg.id}/connectors/a-to-b`, {
      sourceHandle: 'r',
      targetHandle: 't',
    });
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string; sourceHandle?: string; targetHandle?: string }>;
    };
    const conn = onDisk.connectors.find((c) => c.id === 'a-to-b');
    expect(conn?.sourceHandle).toBe('r');
    expect(conn?.targetHandle).toBe('t');
  });

  it("rejects an invalid sourceHandle ('top-bogus') with a 400", async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await patch(app, `/api/demos/${reg.id}/connectors/a-to-b`, {
      sourceHandle: 'top-bogus',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toBeTruthy();
    // The error must mention the offending field so clients can show a
    // useful message. Zod's enum error includes the path 'sourceHandle'.
    const flat = JSON.stringify(body);
    expect(flat).toContain('sourceHandle');
    // File must not have been touched on validation failure.
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it("rejects a target-only handle id on sourceHandle ('t' on source) with a 400", async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    // 't' is a valid handle id but only as a target — sending it as a
    // sourceHandle leaves a stranded endpoint, so the schema rejects it.
    const res = await patch(app, `/api/demos/${reg.id}/connectors/a-to-b`, {
      sourceHandle: 't',
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid targetHandle ('r' on target) with a 400", async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await patch(app, `/api/demos/${reg.id}/connectors/a-to-b`, {
      targetHandle: 'r',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown demoId', async () => {
    const { app } = buildApp();
    const res = await patch(app, '/api/demos/nope/connectors/x', { label: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown connectorId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };
    const res = await patch(app, `/api/demos/${reg.id}/connectors/missing`, { label: 'x' });
    expect(res.status).toBe(404);
  });

  // US-007: sourcePin / targetPin round-trip through the PATCH endpoint, and
  // explicit `null` clears the field on disk (mirrors the sourceHandle: null
  // clearing path from US-025).
  it('persists sourcePin / targetPin on PATCH and clears them with null (US-007)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };
    const demoFile = join(repoPath, '.anydemo', 'demo.json');

    const setRes = await patch(app, `/api/demos/${reg.id}/connectors/a-to-b`, {
      sourcePin: { side: 'right', t: 0.25 },
      targetPin: { side: 'left', t: 0.75 },
    });
    expect(setRes.status).toBe(200);
    let onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<Record<string, unknown>>;
    };
    let conn = onDisk.connectors.find((c) => c.id === 'a-to-b');
    expect(conn?.sourcePin).toEqual({ side: 'right', t: 0.25 });
    expect(conn?.targetPin).toEqual({ side: 'left', t: 0.75 });

    // Clear only the source pin; target pin must survive.
    const clearRes = await patch(app, `/api/demos/${reg.id}/connectors/a-to-b`, {
      sourcePin: null,
    });
    expect(clearRes.status).toBe(200);
    onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<Record<string, unknown>>;
    };
    conn = onDisk.connectors.find((c) => c.id === 'a-to-b');
    expect(conn?.sourcePin).toBeUndefined();
    expect(conn?.targetPin).toEqual({ side: 'left', t: 0.75 });
  });

  it('rejects a sourcePin with an out-of-range t (US-007)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await patch(app, `/api/demos/${reg.id}/connectors/a-to-b`, {
      sourcePin: { side: 'top', t: 1.5 },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/demos/:id/connectors', () => {
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
    connectors: [],
  };

  it('creates a connector, defaults kind to default, auto-generates id', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const res = await post(app, `/api/demos/${reg.id}/connectors`, { source: 'a', target: 'b' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^conn-/);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string; source: string; target: string; kind: string }>;
    };
    expect(onDisk.connectors).toHaveLength(1);
    const created = onDisk.connectors[0];
    expect(created?.id).toBe(body.id);
    expect(created?.source).toBe('a');
    expect(created?.target).toBe('b');
    expect(created?.kind).toBe('default');
  });

  it('honors a caller-provided id and kind', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/demos/${reg.id}/connectors`, {
      id: 'my-conn',
      source: 'a',
      target: 'b',
      kind: 'event',
      eventName: 'OrderPlaced',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('my-conn');
  });

  it('returns 400 with schema issues when source references an unknown node', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await post(app, `/api/demos/${reg.id}/connectors`, {
      source: 'ghost',
      target: 'b',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toContain('schema');
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  // US-022: post-merge DemoSchema parse rejects invalid handle ids on POST too.
  it('returns 400 when posting a connector with an invalid sourceHandle id', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await post(app, `/api/demos/${reg.id}/connectors`, {
      source: 'a',
      target: 'b',
      sourceHandle: 'top-bogus',
    });
    expect(res.status).toBe(400);
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 400 with schema issues when kind-discriminated payload is missing', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    // kind='event' but no eventName — fails the discriminated union shape.
    const res = await post(app, `/api/demos/${reg.id}/connectors`, {
      source: 'a',
      target: 'b',
      kind: 'event',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('schema');
  });

  it('returns 404 for unknown demoId', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/demos/nope/connectors', { source: 'a', target: 'b' });
    expect(res.status).toBe(404);
  });

  // US-023: an iconNode is a valid connector endpoint in either role. The
  // schema's discriminated NodeSchema doesn't constrain who can be a source or
  // target — only that the referenced id exists in nodes[]. These two cases
  // fence that against a future change to operations.ts / schema.ts that might
  // add a node-type whitelist (the bug the user reports is UX-shaped, not
  // server-shaped, but a REST round-trip is the cheapest regression fence).
  it('accepts a connector pointing AT an iconNode (US-023)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo({
      version: 1,
      name: 'Icon target',
      nodes: [
        {
          id: 'svc',
          type: 'stateNode',
          position: { x: 0, y: 0 },
          data: { label: 'S', kind: 'svc', stateSource: { kind: 'request' } },
        },
        {
          id: 'icon-1',
          type: 'iconNode',
          position: { x: 200, y: 0 },
          data: { icon: 'shopping-cart' },
        },
      ],
      connectors: [],
    });
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/demos/${reg.id}/connectors`, {
      source: 'svc',
      target: 'icon-1',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    const onDisk = JSON.parse(readFileSync(join(repoPath, '.anydemo', 'demo.json'), 'utf8')) as {
      connectors: Array<{ id: string; source: string; target: string; kind: string }>;
    };
    expect(onDisk.connectors).toHaveLength(1);
    expect(onDisk.connectors[0]?.id).toBe(body.id);
    expect(onDisk.connectors[0]?.source).toBe('svc');
    expect(onDisk.connectors[0]?.target).toBe('icon-1');
  });

  it('accepts a connector pointing FROM an iconNode (US-023)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo({
      version: 1,
      name: 'Icon source',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode',
          position: { x: 0, y: 0 },
          data: { icon: 'shopping-cart' },
        },
        {
          id: 'svc',
          type: 'stateNode',
          position: { x: 200, y: 0 },
          data: { label: 'S', kind: 'svc', stateSource: { kind: 'request' } },
        },
      ],
      connectors: [],
    });
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/demos/${reg.id}/connectors`, {
      source: 'icon-1',
      target: 'svc',
    });
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(join(repoPath, '.anydemo', 'demo.json'), 'utf8')) as {
      connectors: Array<{ source: string; target: string }>;
    };
    expect(onDisk.connectors).toHaveLength(1);
    expect(onDisk.connectors[0]?.source).toBe('icon-1');
    expect(onDisk.connectors[0]?.target).toBe('svc');
  });

  it('accepts a connector between two iconNodes (US-023)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo({
      version: 1,
      name: 'Icon-to-icon',
      nodes: [
        {
          id: 'icon-a',
          type: 'iconNode',
          position: { x: 0, y: 0 },
          data: { icon: 'circle' },
        },
        {
          id: 'icon-b',
          type: 'iconNode',
          position: { x: 200, y: 0 },
          data: { icon: 'square' },
        },
      ],
      connectors: [],
    });
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/demos/${reg.id}/connectors`, {
      source: 'icon-a',
      target: 'icon-b',
    });
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(join(repoPath, '.anydemo', 'demo.json'), 'utf8')) as {
      connectors: Array<{ source: string; target: string }>;
    };
    expect(onDisk.connectors[0]?.source).toBe('icon-a');
    expect(onDisk.connectors[0]?.target).toBe('icon-b');
  });
});

describe('DELETE /api/demos/:id/connectors/:connId', () => {
  const VALID_DEMO_WITH_TWO_CONNS = {
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

  it('removes only the targeted connector and leaves the rest', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_TWO_CONNS);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const res = await app.request(`/api/demos/${reg.id}/connectors/a-to-b`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string }>;
    };
    expect(onDisk.connectors.map((c) => c.id)).toEqual(['b-to-a']);
  });

  it('returns 404 for unknown demoId', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/demos/nope/connectors/x', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown connectorId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_TWO_CONNS);
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string };
    const res = await app.request(`/api/demos/${reg.id}/connectors/missing`, { method: 'DELETE' });
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

  it('removes the entry when requested by slug', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/demos/register', { repoPath, demoPath: '.anydemo/demo.json' })
    ).json()) as { id: string; slug: string };

    const res = await app.request(`/api/demos/${reg.slug}`, { method: 'DELETE' });
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

describe('POST /api/projects', () => {
  it('detects an existing AnyDemo project at <folder>/.anydemo/demo.json and registers it as-is', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const beforeBytes = readFileSync(join(repoPath, '.anydemo', 'demo.json'), 'utf-8');

    const res = await post(app, '/api/projects', {
      name: 'Existing Project',
      folderPath: repoPath,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; slug: string; scaffolded: boolean };
    expect(body.id).toBeTruthy();
    expect(body.slug).toBe('existing-project');
    expect(body.scaffolded).toBe(false);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.repoPath).toBe(repoPath);
    // Existing demo.json content is untouched (no overwrite, no scaffold).
    expect(readFileSync(join(repoPath, '.anydemo', 'demo.json'), 'utf-8')).toBe(beforeBytes);
  });

  it('scaffolds a fresh project (folder + .anydemo/demo.json) when the target has no setup', async () => {
    const { app, registry } = buildApp();
    const folderPath = mkdtempSync(join(tmpdir(), 'anydemo-create-fresh-'));
    // Sanity: starts empty.
    expect(readdirSync(folderPath)).toHaveLength(0);

    const res = await post(app, '/api/projects', { name: 'Fresh Project', folderPath });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; slug: string; scaffolded: boolean };
    expect(body.scaffolded).toBe(true);
    expect(body.slug).toBe('fresh-project');
    expect(registry.list()).toHaveLength(1);

    // Scaffold written.
    const written = JSON.parse(readFileSync(join(folderPath, '.anydemo', 'demo.json'), 'utf-8'));
    expect(written).toEqual({ version: 1, name: 'Fresh Project', nodes: [], connectors: [] });
  });

  it('creates the parent folder when missing before scaffolding', async () => {
    const { app } = buildApp();
    const parent = mkdtempSync(join(tmpdir(), 'anydemo-create-parent-'));
    const folderPath = join(parent, 'nested', 'project');

    const res = await post(app, '/api/projects', { name: 'Nested', folderPath });

    expect(res.status).toBe(200);
    expect(readFileSync(join(folderPath, '.anydemo', 'demo.json'), 'utf-8')).toContain(
      '"name": "Nested"',
    );
  });

  it('rejects relative folder paths with 400', async () => {
    const { app, registry } = buildApp();
    const res = await post(app, '/api/projects', {
      name: 'Bad path',
      folderPath: 'relative/path',
    });
    expect(res.status).toBe(400);
    expect(registry.list()).toHaveLength(0);
  });

  it('rejects empty name with 400', async () => {
    const { app, registry } = buildApp();
    const res = await post(app, '/api/projects', { name: '', folderPath: '/tmp/anywhere' });
    expect(res.status).toBe(400);
    expect(registry.list()).toHaveLength(0);
  });

  it('returns 400 with issues when an existing demo file fails schema validation', async () => {
    const { app, registry } = buildApp();
    const repoPath = mkdtempSync(join(tmpdir(), 'anydemo-create-bad-'));
    mkdirSync(join(repoPath, '.anydemo'));
    writeFileSync(join(repoPath, '.anydemo', 'demo.json'), JSON.stringify({ version: 1 }));

    const res = await post(app, '/api/projects', { name: 'Bad', folderPath: repoPath });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: Array<{ path: unknown[] }> };
    expect(body.error).toContain('schema validation');
    expect(body.issues?.length ?? 0).toBeGreaterThan(0);
    expect(registry.list()).toHaveLength(0);
  });
});
