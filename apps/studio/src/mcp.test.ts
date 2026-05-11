import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  connectors: [],
};

const tmpRegistry = () => {
  const dir = mkdtempSync(join(tmpdir(), 'anydemo-mcp-reg-'));
  return join(dir, 'registry.json');
};

const tmpRepoWithDemo = (demo: unknown = VALID_DEMO) => {
  const repoDir = mkdtempSync(join(tmpdir(), 'anydemo-mcp-repo-'));
  mkdirSync(join(repoDir, '.anydemo'));
  writeFileSync(join(repoDir, '.anydemo', 'demo.json'), JSON.stringify(demo));
  return repoDir;
};

const tmpEmptyFolder = () => mkdtempSync(join(tmpdir(), 'anydemo-mcp-proj-'));

const buildApp = () => {
  const registry = createRegistry({ path: tmpRegistry() });
  const app = createApp({ mode: 'prod', staticRoot: './dist/web', registry, disableWatcher: true });
  return { app, registry };
};

interface JsonRpcEnvelope {
  jsonrpc: '2.0';
  id: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  };
  error?: { message: string };
}

let rpcId = 1;
const mcpRequest = async (
  app: ReturnType<typeof buildApp>['app'],
  method: string,
  params: Record<string, unknown>,
): Promise<JsonRpcEnvelope> => {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as JsonRpcEnvelope;
};

const callTool = (
  app: ReturnType<typeof buildApp>['app'],
  name: string,
  args: Record<string, unknown> = {},
) => mcpRequest(app, 'tools/call', { name, arguments: args });

const expectOk = (envelope: JsonRpcEnvelope): unknown => {
  expect(envelope.result?.isError).toBeFalsy();
  const text = envelope.result?.content?.[0]?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text ?? 'null');
};

const expectError = (envelope: JsonRpcEnvelope): string => {
  expect(envelope.result?.isError).toBe(true);
  const text = envelope.result?.content?.[0]?.text;
  expect(typeof text).toBe('string');
  return text ?? '';
};

describe('POST /mcp tools/list', () => {
  it('returns the 5 discovery tools registered in US-002', async () => {
    const { app } = buildApp();
    const envelope = await mcpRequest(app, 'tools/list', {});
    const names = (envelope.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([
      'anydemo_create_project',
      'anydemo_delete_demo',
      'anydemo_get_demo',
      'anydemo_list_demos',
      'anydemo_register_demo',
    ]);
  });

  it('emits inputSchemas derived from the Zod bodies for register + create_project', async () => {
    const { app } = buildApp();
    const envelope = await mcpRequest(app, 'tools/list', {});
    const byName = new Map((envelope.result?.tools ?? []).map((t) => [t.name, t]));

    const register = byName.get('anydemo_register_demo');
    expect(register?.inputSchema?.type).toBe('object');
    const registerProps = register?.inputSchema?.properties as Record<string, unknown>;
    expect(Object.keys(registerProps)).toEqual(expect.arrayContaining(['repoPath', 'demoPath']));

    const createProject = byName.get('anydemo_create_project');
    const cpProps = createProject?.inputSchema?.properties as Record<string, unknown>;
    expect(Object.keys(cpProps)).toEqual(expect.arrayContaining(['name', 'folderPath']));
  });
});

describe('anydemo_list_demos', () => {
  it('returns the registry list (initially empty)', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'anydemo_list_demos');
    expect(expectOk(envelope)).toEqual([]);
  });

  it('reflects entries added through anydemo_register_demo', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    await callTool(app, 'anydemo_register_demo', {
      repoPath,
      demoPath: '.anydemo/demo.json',
    });

    const envelope = await callTool(app, 'anydemo_list_demos');
    const list = expectOk(envelope) as Array<{ slug: string; valid: boolean; name: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe('checkout-flow');
    expect(list[0]?.valid).toBe(true);
  });
});

describe('anydemo_get_demo', () => {
  it('returns the validated demo for a registered id', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const registerEnvelope = await callTool(app, 'anydemo_register_demo', {
      repoPath,
      demoPath: '.anydemo/demo.json',
    });
    const reg = expectOk(registerEnvelope) as { id: string };

    const envelope = await callTool(app, 'anydemo_get_demo', { demoId: reg.id });
    const body = expectOk(envelope) as {
      id: string;
      valid: boolean;
      demo: { name: string };
      error: string | null;
    };
    expect(body.id).toBe(reg.id);
    expect(body.valid).toBe(true);
    expect(body.demo.name).toBe('Checkout Flow');
    expect(body.error).toBeNull();
  });

  it('returns an isError result for an unknown demoId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'anydemo_get_demo', { demoId: 'does-not-exist' });
    expect(expectError(envelope)).toBe('not found');
  });
});

describe('anydemo_register_demo', () => {
  it('registers a valid demo and returns id + slug + sdk outcome', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const envelope = await callTool(app, 'anydemo_register_demo', {
      repoPath,
      demoPath: '.anydemo/demo.json',
    });
    const body = expectOk(envelope) as {
      id: string;
      slug: string;
      sdk: { outcome: string; filePath: string | null };
    };
    expect(body.slug).toBe('checkout-flow');
    expect(body.sdk).toEqual({ outcome: 'skipped', filePath: null });
    expect(registry.list()).toHaveLength(1);
  });

  it('errors when the demo file is missing on disk', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'anydemo_register_demo', {
      repoPath: '/this/path/does/not/exist',
      demoPath: '.anydemo/demo.json',
    });
    const text = expectError(envelope);
    expect(text).toContain('Demo file not found');
    expect(text).toContain('/this/path/does/not/exist');
  });
});

describe('anydemo_delete_demo', () => {
  it('removes a registered demo and accepts id or slug', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const regEnvelope = await callTool(app, 'anydemo_register_demo', {
      repoPath,
      demoPath: '.anydemo/demo.json',
    });
    const reg = expectOk(regEnvelope) as { id: string; slug: string };
    expect(registry.list()).toHaveLength(1);

    const byIdEnvelope = await callTool(app, 'anydemo_delete_demo', { demoId: reg.id });
    expect(expectOk(byIdEnvelope)).toEqual({ ok: true });
    expect(registry.list()).toHaveLength(0);

    // Slug-based deletion mirrors REST DELETE /api/demos/:id behavior.
    const repoPath2 = tmpRepoWithDemo();
    const second = expectOk(
      await callTool(app, 'anydemo_register_demo', {
        repoPath: repoPath2,
        demoPath: '.anydemo/demo.json',
      }),
    ) as { slug: string };
    const bySlugEnvelope = await callTool(app, 'anydemo_delete_demo', { demoId: second.slug });
    expect(expectOk(bySlugEnvelope)).toEqual({ ok: true });
    expect(registry.list()).toHaveLength(0);
  });

  it('errors with "not found" for an unknown demoId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'anydemo_delete_demo', { demoId: 'does-not-exist' });
    expect(expectError(envelope)).toBe('not found');
  });
});

describe('anydemo_create_project', () => {
  it('scaffolds a new project folder and writes .anydemo/demo.json', async () => {
    const { app, registry } = buildApp();
    const folderPath = tmpEmptyFolder();
    const envelope = await callTool(app, 'anydemo_create_project', {
      name: 'Brand New Demo',
      folderPath,
    });
    const body = expectOk(envelope) as { id: string; slug: string; scaffolded: boolean };
    expect(body.scaffolded).toBe(true);
    expect(body.slug).toBe('brand-new-demo');
    expect(existsSync(join(folderPath, '.anydemo', 'demo.json'))).toBe(true);
    expect(registry.list()).toHaveLength(1);
  });

  it('errors with the same human-readable text when folderPath is not absolute', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'anydemo_create_project', {
      name: 'Relative Path',
      folderPath: 'relative/path',
    });
    expect(expectError(envelope)).toBe('folderPath must be an absolute filesystem path');
  });
});
