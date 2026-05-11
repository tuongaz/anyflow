import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  it('returns the discovery + node-lifecycle + patch tools (5 + 4 + 1)', async () => {
    const { app } = buildApp();
    const envelope = await mcpRequest(app, 'tools/list', {});
    const names = (envelope.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([
      'anydemo_add_node',
      'anydemo_create_project',
      'anydemo_delete_demo',
      'anydemo_delete_node',
      'anydemo_get_demo',
      'anydemo_list_demos',
      'anydemo_move_node',
      'anydemo_patch_node',
      'anydemo_register_demo',
      'anydemo_reorder_node',
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

// ---------- Node lifecycle tools (US-003) ----------

// Multi-node fixture for delete-cascade and reorder coverage. Nodes a/b/c
// chained via connectors a→b and b→c.
const VALID_DEMO_THREE_NODES = {
  version: 1,
  name: 'Three Nodes',
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

interface RegisterResult {
  id: string;
  slug: string;
}

const registerFixture = async (
  app: ReturnType<typeof buildApp>['app'],
  demo: unknown = VALID_DEMO,
) => {
  const repoPath = tmpRepoWithDemo(demo);
  const envelope = await callTool(app, 'anydemo_register_demo', {
    repoPath,
    demoPath: '.anydemo/demo.json',
  });
  const reg = expectOk(envelope) as RegisterResult;
  return { repoPath, demoFile: join(repoPath, '.anydemo', 'demo.json'), reg };
};

describe('anydemo_add_node', () => {
  it('appends a new node and auto-generates an id when absent', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);

    const envelope = await callTool(app, 'anydemo_add_node', {
      demoId: reg.id,
      node: {
        type: 'shapeNode',
        position: { x: 100, y: 200 },
        data: { shape: 'rectangle', label: 'Note A' },
      },
    });
    const body = expectOk(envelope) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^node-/);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; type: string }>;
    };
    expect(onDisk.nodes).toHaveLength(2);
    expect(onDisk.nodes.find((n) => n.id === body.id)?.type).toBe('shapeNode');
  });

  it('returns isError with schema text when the new node is malformed', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);
    const before = readFileSync(demoFile, 'utf8');

    // shapeNode without required `shape` — DemoSchema rejects the post-merge.
    const envelope = await callTool(app, 'anydemo_add_node', {
      demoId: reg.id,
      node: { type: 'shapeNode', position: { x: 0, y: 0 }, data: {} },
    });
    expect(expectError(envelope)).toContain('Demo failed schema validation');
    // File untouched on failed validation.
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('errors with "unknown demo" for an unknown demoId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'anydemo_add_node', {
      demoId: 'does-not-exist',
      node: { type: 'shapeNode', position: { x: 0, y: 0 }, data: { shape: 'rectangle' } },
    });
    expect(expectError(envelope)).toBe('unknown demo');
  });
});

describe('anydemo_delete_node', () => {
  it('removes the node and cascades adjacent connectors in one write', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_THREE_NODES);

    const envelope = await callTool(app, 'anydemo_delete_node', { demoId: reg.id, nodeId: 'b' });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string }>;
      connectors: Array<{ id: string }>;
    };
    expect(onDisk.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    // Both a-to-b and b-to-c referenced node 'b' — cascade-removed.
    expect(onDisk.connectors).toEqual([]);
  });

  it('errors with the node id in the message for an unknown nodeId', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);
    const envelope = await callTool(app, 'anydemo_delete_node', {
      demoId: reg.id,
      nodeId: 'missing',
    });
    expect(expectError(envelope)).toBe('Unknown nodeId: missing');
  });
});

describe('anydemo_move_node', () => {
  it('writes { x, y } back to the on-disk node position', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);

    const envelope = await callTool(app, 'anydemo_move_node', {
      demoId: reg.id,
      nodeId: 'api-checkout',
      x: 250,
      y: 320,
    });
    const body = expectOk(envelope) as { ok: boolean; position: { x: number; y: number } };
    expect(body).toEqual({ ok: true, position: { x: 250, y: 320 } });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
    };
    expect(onDisk.nodes[0]?.position).toEqual({ x: 250, y: 320 });
  });

  it('errors for an unknown nodeId', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);
    const envelope = await callTool(app, 'anydemo_move_node', {
      demoId: reg.id,
      nodeId: 'nope',
      x: 0,
      y: 0,
    });
    expect(expectError(envelope)).toBe('Unknown nodeId: nope');
  });
});

describe('anydemo_reorder_node', () => {
  const onDiskOrder = (demoFile: string) =>
    (JSON.parse(readFileSync(demoFile, 'utf8')) as { nodes: Array<{ id: string }> }).nodes.map(
      (n) => n.id,
    );

  it('moves a node forward (swap with the next sibling)', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_THREE_NODES);

    const envelope = await callTool(app, 'anydemo_reorder_node', {
      demoId: reg.id,
      nodeId: 'a',
      op: 'forward',
    });
    expect(expectOk(envelope)).toEqual({ ok: true });
    expect(onDiskOrder(demoFile)).toEqual(['b', 'a', 'c']);
  });

  it('toIndex pins the node to an absolute index', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_THREE_NODES);

    const envelope = await callTool(app, 'anydemo_reorder_node', {
      demoId: reg.id,
      nodeId: 'a',
      op: 'toIndex',
      index: 2,
    });
    expect(expectOk(envelope)).toEqual({ ok: true });
    expect(onDiskOrder(demoFile)).toEqual(['b', 'c', 'a']);
  });

  it('errors for an unknown nodeId', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app, VALID_DEMO_THREE_NODES);
    const envelope = await callTool(app, 'anydemo_reorder_node', {
      demoId: reg.id,
      nodeId: 'missing',
      op: 'forward',
    });
    expect(expectError(envelope)).toBe('Unknown nodeId: missing');
  });

  it('rejects invalid op via the discriminated union', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);
    const envelope = await callTool(app, 'anydemo_reorder_node', {
      demoId: reg.id,
      nodeId: 'api-checkout',
      op: 'noSuchOp',
    });
    expect(expectError(envelope)).toContain('Invalid reorder_node arguments');
  });
});

// ---------- Node patch tool (US-004) ----------

describe('anydemo_patch_node', () => {
  it('exposes NodePatchBodySchema fields plus demoId/nodeId in inputSchema', async () => {
    const { app } = buildApp();
    const envelope = await mcpRequest(app, 'tools/list', {});
    const tool = (envelope.result?.tools ?? []).find((t) => t.name === 'anydemo_patch_node');
    expect(tool).toBeDefined();
    const props = tool?.inputSchema?.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining([
        'demoId',
        'nodeId',
        'position',
        'label',
        'detail',
        'borderColor',
        'backgroundColor',
        'borderSize',
        'borderStyle',
        'fontSize',
        'cornerRadius',
        'width',
        'height',
        'shape',
      ]),
    );
    const required = tool?.inputSchema?.required as string[];
    expect(required).toEqual(expect.arrayContaining(['demoId', 'nodeId']));
  });

  it('merges a partial label update into node.data and rewrites the file', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);

    const envelope = await callTool(app, 'anydemo_patch_node', {
      demoId: reg.id,
      nodeId: 'api-checkout',
      label: 'POST /checkout (renamed)',
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{
        id: string;
        position: { x: number; y: number };
        data: { label: string; playAction: { kind: string } };
      }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.label).toBe('POST /checkout (renamed)');
    // Untouched fields preserved.
    expect(node?.data.playAction.kind).toBe('http');
    expect(node?.position).toEqual({ x: 0, y: 0 });
  });

  it('merges multiple fields at once (label + borderColor + width + height)', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);

    const envelope = await callTool(app, 'anydemo_patch_node', {
      demoId: reg.id,
      nodeId: 'api-checkout',
      label: 'Multi-Edit',
      borderColor: 'blue',
      backgroundColor: 'amber',
      width: 240,
      height: 120,
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{
        id: string;
        data: {
          label: string;
          borderColor?: string;
          backgroundColor?: string;
          width?: number;
          height?: number;
        };
      }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.label).toBe('Multi-Edit');
    expect(node?.data.borderColor).toBe('blue');
    expect(node?.data.backgroundColor).toBe('amber');
    expect(node?.data.width).toBe(240);
    expect(node?.data.height).toBe(120);
  });

  it('updates node.position when included in the patch body', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);

    const envelope = await callTool(app, 'anydemo_patch_node', {
      demoId: reg.id,
      nodeId: 'api-checkout',
      position: { x: 42, y: 84 },
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
    };
    expect(onDisk.nodes[0]?.position).toEqual({ x: 42, y: 84 });
  });

  it('rejects schema-violating input before the handler runs (borderColor outside enum)', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);
    const before = readFileSync(demoFile, 'utf8');

    const envelope = await callTool(app, 'anydemo_patch_node', {
      demoId: reg.id,
      nodeId: 'api-checkout',
      borderColor: 'neon-pink',
    });
    expect(expectError(envelope)).toContain('Invalid patch_node arguments');
    // File untouched — Zod rejected before any IO.
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('rejects unknown top-level keys via .strict()', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);

    const envelope = await callTool(app, 'anydemo_patch_node', {
      demoId: reg.id,
      nodeId: 'api-checkout',
      somethingMadeUp: true,
    });
    expect(expectError(envelope)).toContain('Invalid patch_node arguments');
  });

  it('returns isError for an unknown demoId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'anydemo_patch_node', {
      demoId: 'does-not-exist',
      nodeId: 'api-checkout',
      label: 'x',
    });
    expect(expectError(envelope)).toBe('unknown demo');
  });

  it('returns isError with the node id in the message for an unknown nodeId', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);

    const envelope = await callTool(app, 'anydemo_patch_node', {
      demoId: reg.id,
      nodeId: 'missing',
      label: 'x',
    });
    expect(expectError(envelope)).toBe('Unknown nodeId: missing');
  });

  it('returns Demo failed schema validation when the post-merge demo violates DemoSchema', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);
    const before = readFileSync(demoFile, 'utf8');

    // Empty label on a functional playNode trips DemoSchema after merge.
    const envelope = await callTool(app, 'anydemo_patch_node', {
      demoId: reg.id,
      nodeId: 'api-checkout',
      label: '',
    });
    expect(expectError(envelope)).toContain('Demo failed schema validation');
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('preserves unknown forward-compat fields on the on-disk node across the round-trip', async () => {
    const { app } = buildApp();
    // Hand-craft the demo with a node carrying an unknown field DemoSchema
    // doesn't recognize. DemoSchema strips it on parse but the patch handler
    // mutates the raw parsed JSON so the on-disk file retains the field.
    const repoPath = tmpRepoWithDemo({
      version: 1,
      name: 'Forward Compat',
      nodes: [
        {
          id: 'fc',
          type: 'playNode',
          position: { x: 0, y: 0 },
          futureField: 'survives',
          data: {
            label: 'Future',
            kind: 'service',
            stateSource: { kind: 'request' },
            playAction: { kind: 'http', method: 'POST', url: 'http://example.test/fc' },
          },
        },
      ],
      connectors: [],
    });
    const reg = expectOk(
      await callTool(app, 'anydemo_register_demo', {
        repoPath,
        demoPath: '.anydemo/demo.json',
      }),
    ) as RegisterResult;

    const envelope = await callTool(app, 'anydemo_patch_node', {
      demoId: reg.id,
      nodeId: 'fc',
      label: 'After Patch',
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const demoFile = join(repoPath, '.anydemo', 'demo.json');
    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; futureField?: string; data: { label: string } }>;
    };
    expect(onDisk.nodes[0]?.futureField).toBe('survives');
    expect(onDisk.nodes[0]?.data.label).toBe('After Patch');
  });
});
