import { describe, expect, it } from 'bun:test';
import { DemoSchema } from './schema.ts';

const fixturePath = (name: string) => new URL(`../test/fixtures/${name}`, import.meta.url).pathname;

const readFixture = async (name: string): Promise<unknown> =>
  await Bun.file(fixturePath(name)).json();

describe('DemoSchema', () => {
  it('parses a valid demo fixture', async () => {
    const data = await readFixture('valid-demo.json');
    const result = DemoSchema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `expected valid fixture to parse, got: ${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
    expect(result.data.version).toBe(1);
    expect(result.data.name).toBe('Checkout flow');
    expect(result.data.nodes).toHaveLength(2);
    expect(result.data.connectors).toHaveLength(1);
    const connector = result.data.connectors[0];
    if (connector?.kind !== 'event') throw new Error('expected event connector');
    expect(connector.eventName).toBe('checkout.created');
    expect(connector.label).toBe('publishes checkout.created');
  });

  it('rejects an invalid demo fixture with a usable Zod error', async () => {
    const data = await readFixture('invalid-demo.json');
    const result = DemoSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.length).toBeGreaterThan(0);

    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    expect(message.length).toBeGreaterThan(0);

    const nameIssue = result.error.issues.find(
      (issue) => issue.path.length === 1 && issue.path[0] === 'name',
    );
    expect(nameIssue).toBeDefined();
  });

  it('rejects an invalid-demo-connector fixture (connector references missing nodeId)', async () => {
    const data = await readFixture('invalid-demo-connector.json');
    const result = DemoSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;

    const targetIssue = result.error.issues.find(
      (i) =>
        i.path.length === 3 &&
        i.path[0] === 'connectors' &&
        i.path[1] === 0 &&
        i.path[2] === 'target',
    );
    expect(targetIssue).toBeDefined();
    expect(targetIssue?.message).toContain('ghost-node');
  });

  it('parses connectors of all three kinds: http, event, queue', () => {
    const demo = {
      version: 1 as const,
      name: 'all-kinds',
      nodes: [
        {
          id: 'a',
          type: 'playNode' as const,
          position: { x: 0, y: 0 },
          data: {
            label: 'A',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            playAction: { kind: 'http' as const, method: 'GET' as const, url: 'http://x' },
          },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'c',
          type: 'stateNode' as const,
          position: { x: 200, y: 0 },
          data: { label: 'C', kind: 'worker', stateSource: { kind: 'event' as const } },
        },
        {
          id: 'd',
          type: 'stateNode' as const,
          position: { x: 300, y: 0 },
          data: { label: 'D', kind: 'worker', stateSource: { kind: 'event' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          kind: 'http' as const,
          method: 'POST' as const,
          url: 'http://b/',
          label: 'calls B',
        },
        {
          id: 'c2',
          source: 'a',
          target: 'c',
          kind: 'event' as const,
          eventName: 'a.published',
        },
        {
          id: 'c3',
          source: 'a',
          target: 'd',
          kind: 'queue' as const,
          queueName: 'work-queue',
        },
      ],
    };

    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.data.connectors).toHaveLength(3);
    expect(result.data.connectors[0]?.kind).toBe('http');
    expect(result.data.connectors[1]?.kind).toBe('event');
    expect(result.data.connectors[2]?.kind).toBe('queue');
  });

  it('rejects a connector with an unknown discriminator kind', () => {
    const demo = {
      version: 1 as const,
      name: 'bad-kind',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'whisper' }],
    };
    const result = DemoSchema.safeParse(demo);
    expect(result.success).toBe(false);
  });

  it('round-trips a shapeNode with each shape variant', () => {
    const make = (shape: 'rectangle' | 'ellipse' | 'sticky') => ({
      version: 1 as const,
      name: 'shape-demo',
      nodes: [
        {
          id: `shape-${shape}`,
          type: 'shapeNode' as const,
          position: { x: 10, y: 20 },
          data: { shape, label: `${shape} note` },
        },
      ],
      connectors: [],
    });

    for (const shape of ['rectangle', 'ellipse', 'sticky'] as const) {
      const result = DemoSchema.safeParse(make(shape));
      if (!result.success) {
        throw new Error(
          `expected ${shape} shapeNode to parse, got: ${JSON.stringify(result.error.issues)}`,
        );
      }
      const node = result.data.nodes[0];
      if (node?.type !== 'shapeNode') throw new Error('expected shapeNode');
      expect(node.data.shape).toBe(shape);
      expect(node.data.label).toBe(`${shape} note`);
    }
  });

  it('accepts a shapeNode without an optional label', () => {
    const demo = {
      version: 1 as const,
      name: 'no-label-shape',
      nodes: [
        {
          id: 'shape-1',
          type: 'shapeNode' as const,
          position: { x: 0, y: 0 },
          data: { shape: 'rectangle' as const },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
    expect(result.success).toBe(true);
  });

  it('rejects a shapeNode with an unknown shape variant', () => {
    const demo = {
      version: 1 as const,
      name: 'bad-shape',
      nodes: [
        {
          id: 'shape-1',
          type: 'shapeNode' as const,
          position: { x: 0, y: 0 },
          data: { shape: 'triangle' },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
    expect(result.success).toBe(false);
  });

  it('accepts node visual fields (width/height/borderColor/backgroundColor) on every node type', () => {
    const demo = {
      version: 1 as const,
      name: 'visual-fields',
      nodes: [
        {
          id: 'p',
          type: 'playNode' as const,
          position: { x: 0, y: 0 },
          data: {
            label: 'P',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            playAction: { kind: 'http' as const, method: 'GET' as const, url: 'http://x' },
            width: 200,
            height: 80,
            borderColor: 'blue' as const,
            backgroundColor: 'amber' as const,
          },
        },
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: {
            label: 'S',
            kind: 'worker',
            stateSource: { kind: 'event' as const },
            width: 160,
            height: 60,
          },
        },
        {
          id: 'shape-1',
          type: 'shapeNode' as const,
          position: { x: 200, y: 0 },
          data: {
            shape: 'sticky' as const,
            width: 240,
            height: 140,
            borderColor: 'amber' as const,
            backgroundColor: 'amber' as const,
          },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.nodes).toHaveLength(3);
  });

  it('accepts nodes that omit the new visual fields entirely (backwards compatible)', () => {
    const demo = {
      version: 1 as const,
      name: 'no-visual-fields',
      nodes: [
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'S', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [],
    };
    expect(DemoSchema.safeParse(demo).success).toBe(true);
  });

  it('rejects width/height that are zero or negative', () => {
    const demo = (width: number, height: number) => ({
      version: 1 as const,
      name: 'bad-size',
      nodes: [
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: {
            label: 'S',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            width,
            height,
          },
        },
      ],
      connectors: [],
    });
    expect(DemoSchema.safeParse(demo(0, 80)).success).toBe(false);
    expect(DemoSchema.safeParse(demo(-1, 80)).success).toBe(false);
    expect(DemoSchema.safeParse(demo(120, 0)).success).toBe(false);
  });

  it('rejects an invalid color token (only enum values allowed)', () => {
    const demo = {
      version: 1 as const,
      name: 'bad-color',
      nodes: [
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: {
            label: 'S',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            borderColor: 'fuchsia',
          },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (i) => i.path.includes('borderColor') && i.path.includes('data'),
    );
    expect(issue).toBeDefined();
  });

  it('round-trips a default connector with no semantic payload', () => {
    const demo = {
      version: 1 as const,
      name: 'default-conn',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        { id: 'c1', source: 'a', target: 'b', kind: 'default' as const, label: 'see also' },
      ],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    if (conn?.kind !== 'default') throw new Error('expected default connector');
    expect(conn.label).toBe('see also');
  });

  it('accepts connector visual fields (style/color/direction) on every kind', () => {
    const demo = {
      version: 1 as const,
      name: 'visual-connectors',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          kind: 'http' as const,
          method: 'POST' as const,
          url: 'http://b/',
          style: 'dashed' as const,
          color: 'blue' as const,
          direction: 'forward' as const,
        },
        {
          id: 'c2',
          source: 'a',
          target: 'b',
          kind: 'event' as const,
          eventName: 'a.b',
          style: 'solid' as const,
          direction: 'both' as const,
        },
        {
          id: 'c3',
          source: 'a',
          target: 'b',
          kind: 'default' as const,
          color: 'amber' as const,
          direction: 'backward' as const,
        },
      ],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.connectors).toHaveLength(3);
  });

  it('round-trips optional sourceHandle/targetHandle on connectors (US-013)', () => {
    const demo = {
      version: 1 as const,
      name: 'connector-handles',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          sourceHandle: 'b',
          targetHandle: 't',
          kind: 'default' as const,
        },
      ],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    if (conn?.kind !== 'default') throw new Error('expected default connector');
    expect(conn.sourceHandle).toBe('b');
    expect(conn.targetHandle).toBe('t');
  });

  it('parses connectors authored without handle ids (back-compat for US-013)', () => {
    const demo = {
      version: 1 as const,
      name: 'no-handles',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default' as const }],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    if (conn?.kind !== 'default') throw new Error('expected default connector');
    expect(conn.sourceHandle).toBeUndefined();
    expect(conn.targetHandle).toBeUndefined();
  });

  it('round-trips optional sourcePin/targetPin on connectors (US-006)', () => {
    const demo = {
      version: 1 as const,
      name: 'connector-pins',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          kind: 'default' as const,
          sourcePin: { side: 'right' as const, t: 0.25 },
          targetPin: { side: 'left' as const, t: 0.75 },
        },
      ],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    if (conn?.kind !== 'default') throw new Error('expected default connector');
    expect(conn.sourcePin).toEqual({ side: 'right', t: 0.25 });
    expect(conn.targetPin).toEqual({ side: 'left', t: 0.75 });
  });

  it('parses connectors authored without sourcePin/targetPin (back-compat for US-006)', () => {
    const demo = {
      version: 1 as const,
      name: 'no-pins',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default' as const }],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    if (conn?.kind !== 'default') throw new Error('expected default connector');
    expect(conn.sourcePin).toBeUndefined();
    expect(conn.targetPin).toBeUndefined();
  });

  it('rejects a pin with an unknown side (US-006)', () => {
    const demo = {
      version: 1 as const,
      name: 'bad-pin-side',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          kind: 'default' as const,
          sourcePin: { side: 'diagonal', t: 0.5 },
        },
      ],
    };
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects a pin with t outside [0, 1] (US-006)', () => {
    const make = (t: unknown) => ({
      version: 1 as const,
      name: 'bad-pin-t',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          kind: 'default' as const,
          sourcePin: { side: 'top' as const, t },
        },
      ],
    });
    expect(DemoSchema.safeParse(make(-0.1)).success).toBe(false);
    expect(DemoSchema.safeParse(make(1.1)).success).toBe(false);
    expect(DemoSchema.safeParse(make(0)).success).toBe(true);
    expect(DemoSchema.safeParse(make(1)).success).toBe(true);
  });

  it('rejects an invalid connector style value', () => {
    const demo = {
      version: 1 as const,
      name: 'bad-style',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default', style: 'wavy' }],
    };
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an invalid connector direction value', () => {
    const demo = {
      version: 1 as const,
      name: 'bad-dir',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default', direction: 'sideways' }],
    };
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an invalid connector color token', () => {
    const demo = {
      version: 1 as const,
      name: 'bad-color',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default', color: 'fuchsia' }],
    };
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  it('accepts a positive borderSize on nodes and connectors, rejects 0/negative', () => {
    const make = (nodeBorderSize: unknown, connBorderSize: unknown) => ({
      version: 1 as const,
      name: 'border-size',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: {
            label: 'A',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            borderSize: nodeBorderSize,
          },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          kind: 'default' as const,
          borderSize: connBorderSize,
        },
      ],
    });

    // node borderSize: 3, connector borderSize: 4 — both accepted.
    const ok = DemoSchema.safeParse(make(3, 4));
    if (!ok.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(ok.error.issues)}`);
    }
    const node = ok.data.nodes[0];
    if (node?.type !== 'stateNode') throw new Error('expected stateNode');
    expect(node.data.borderSize).toBe(3);
    expect(ok.data.connectors[0]?.borderSize).toBe(4);

    // 0 and negative values rejected (positive constraint).
    expect(DemoSchema.safeParse(make(0, 4)).success).toBe(false);
    expect(DemoSchema.safeParse(make(-2, 4)).success).toBe(false);
  });

  it('accepts cornerRadius=12 and cornerRadius=0 on a node, rejects negative values (US-001)', () => {
    const make = (cornerRadius: unknown) => ({
      version: 1 as const,
      name: 'corner-radius',
      nodes: [
        {
          id: 'p',
          type: 'playNode' as const,
          position: { x: 0, y: 0 },
          data: {
            label: 'P',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            playAction: { kind: 'http' as const, method: 'GET' as const, url: 'http://x' },
            cornerRadius,
          },
        },
      ],
      connectors: [],
    });

    const ok12 = DemoSchema.safeParse(make(12));
    if (!ok12.success) {
      throw new Error(
        `expected cornerRadius=12 to parse, got: ${JSON.stringify(ok12.error.issues)}`,
      );
    }
    const node12 = ok12.data.nodes[0];
    if (node12?.type !== 'playNode') throw new Error('expected playNode');
    expect(node12.data.cornerRadius).toBe(12);

    const ok0 = DemoSchema.safeParse(make(0));
    if (!ok0.success) {
      throw new Error(`expected cornerRadius=0 to parse, got: ${JSON.stringify(ok0.error.issues)}`);
    }

    expect(DemoSchema.safeParse(make(-5)).success).toBe(false);
  });

  it('parses a demo containing one imageNode with a base64 data URL (US-002)', () => {
    const demo = {
      version: 1 as const,
      name: 'image-demo',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 10, y: 20 },
          data: {
            image:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
            alt: 'pixel',
            width: 200,
            height: 150,
          },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'imageNode') throw new Error('expected imageNode');
    expect(node.data.image.startsWith('data:image/png;base64,')).toBe(true);
    expect(node.data.alt).toBe('pixel');
  });

  it('rejects an imageNode whose image is not a data URL (US-002)', () => {
    const demo = {
      version: 1 as const,
      name: 'bad-image',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 0, y: 0 },
          data: { image: 'https://example.com/cat.png' },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
    expect(result.success).toBe(false);
  });

  it('accepts a connector pointing at an imageNode id (US-002)', () => {
    const demo = {
      version: 1 as const,
      name: 'image-conn',
      nodes: [
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'S', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 100, y: 0 },
          data: {
            image:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
          },
        },
      ],
      connectors: [{ id: 'c1', source: 's', target: 'img-1', kind: 'default' as const }],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.connectors).toHaveLength(1);
  });

  // US-023: an iconNode is a valid connector endpoint in either role — the
  // connector→node superRefine cares only that the referenced id exists in
  // nodes[], not about the node's discriminator. Schema-level fence so a future
  // change can't add a hidden node-type whitelist.
  it('accepts a connector pointing at an iconNode id as source AND target (US-023)', () => {
    const demo = {
      version: 1 as const,
      name: 'icon-conn',
      nodes: [
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'S', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 100, y: 0 },
          data: { icon: 'shopping-cart' },
        },
        {
          id: 'icon-2',
          type: 'iconNode' as const,
          position: { x: 200, y: 0 },
          data: { icon: 'circle' },
        },
      ],
      connectors: [
        // stateNode → iconNode
        { id: 'c1', source: 's', target: 'icon-1', kind: 'default' as const },
        // iconNode → stateNode
        { id: 'c2', source: 'icon-1', target: 's', kind: 'default' as const },
        // iconNode → iconNode
        { id: 'c3', source: 'icon-1', target: 'icon-2', kind: 'default' as const },
      ],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.connectors).toHaveLength(3);
  });

  it('parses a demo with a top-level resetAction (US-003)', () => {
    const demo = {
      version: 1 as const,
      name: 'reset-demo',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [],
      resetAction: { kind: 'http' as const, method: 'POST' as const, url: '/reset' },
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.resetAction?.kind).toBe('http');
    expect(result.data.resetAction?.method).toBe('POST');
    expect(result.data.resetAction?.url).toBe('/reset');
  });

  it('parses a demo without resetAction (back-compat for US-003)', () => {
    const demo = {
      version: 1 as const,
      name: 'no-reset',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.resetAction).toBeUndefined();
  });

  it('parses an iconNode with only the required icon field (US-008)', () => {
    const demo = {
      version: 1 as const,
      name: 'icon-demo',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 10, y: 20 },
          data: { icon: 'shopping-cart' },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'iconNode') throw new Error('expected iconNode');
    expect(node.data.icon).toBe('shopping-cart');
    expect(node.data.color).toBeUndefined();
    expect(node.data.strokeWidth).toBeUndefined();
  });

  it('parses an iconNode with every optional field set (US-008)', () => {
    const demo = {
      version: 1 as const,
      name: 'icon-full',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 0, y: 0 },
          data: {
            icon: 'help-circle',
            color: 'blue' as const,
            strokeWidth: 1.5,
            width: 64,
            height: 64,
            alt: 'help indicator',
            label: 'Help',
          },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'iconNode') throw new Error('expected iconNode');
    expect(node.data.icon).toBe('help-circle');
    expect(node.data.color).toBe('blue');
    expect(node.data.strokeWidth).toBe(1.5);
    expect(node.data.width).toBe(64);
    expect(node.data.height).toBe(64);
    expect(node.data.alt).toBe('help indicator');
    expect(node.data.label).toBe('Help');
  });

  it('parses an iconNode with an empty label (US-002 backwards compat sentinel)', () => {
    // Empty string is the documented "no label" sentinel and must round-trip
    // through the schema (consumers can treat empty + absent the same way at
    // render time without needing a coercion step).
    const demo = {
      version: 1 as const,
      name: 'icon-empty-label',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 0, y: 0 },
          data: { icon: 'shopping-cart', label: '' },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'iconNode') throw new Error('expected iconNode');
    expect(node.data.label).toBe('');
  });

  it('rejects an iconNode with an empty icon string (US-008)', () => {
    const demo = {
      version: 1 as const,
      name: 'bad-icon',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 0, y: 0 },
          data: { icon: '' },
        },
      ],
      connectors: [],
    };
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an iconNode strokeWidth outside [0.5, 4] (US-008)', () => {
    const make = (strokeWidth: number) => ({
      version: 1 as const,
      name: 'bad-stroke',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 0, y: 0 },
          data: { icon: 'shopping-cart', strokeWidth },
        },
      ],
      connectors: [],
    });
    expect(DemoSchema.safeParse(make(0.25)).success).toBe(false);
    expect(DemoSchema.safeParse(make(4.5)).success).toBe(false);
    expect(DemoSchema.safeParse(make(0.5)).success).toBe(true);
    expect(DemoSchema.safeParse(make(4)).success).toBe(true);
  });

  it('rejects an iconNode with non-positive width or height (US-008)', () => {
    const make = (width: number, height: number) => ({
      version: 1 as const,
      name: 'bad-icon-size',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 0, y: 0 },
          data: { icon: 'shopping-cart', width, height },
        },
      ],
      connectors: [],
    });
    expect(DemoSchema.safeParse(make(0, 48)).success).toBe(false);
    expect(DemoSchema.safeParse(make(-10, 48)).success).toBe(false);
    expect(DemoSchema.safeParse(make(48, 0)).success).toBe(false);
    expect(DemoSchema.safeParse(make(48, -10)).success).toBe(false);
  });

  it('round-trips optional connector fontSize (US-018)', () => {
    const demo = {
      version: 1 as const,
      name: 'connector-fontsize',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default' as const, fontSize: 16 }],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    if (conn?.kind !== 'default') throw new Error('expected default connector');
    expect(conn.fontSize).toBe(16);
  });

  it('rejects non-positive connector fontSize (US-018)', () => {
    const make = (size: number) => ({
      version: 1 as const,
      name: 'connector-fontsize-bad',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { label: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { label: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        { id: 'c1', source: 'a', target: 'b', kind: 'default' as const, fontSize: size },
      ],
    });
    expect(DemoSchema.safeParse(make(0)).success).toBe(false);
    expect(DemoSchema.safeParse(make(-1)).success).toBe(false);
    expect(DemoSchema.safeParse(make(12)).success).toBe(true);
  });

  it('treats data.handlerModule as optional and reserved (no runtime use yet)', () => {
    const baseData = {
      label: 'worker',
      kind: 'worker',
      stateSource: { kind: 'event' as const },
    };
    const baseDemo = (data: Record<string, unknown>) => ({
      version: 1 as const,
      name: 'minimal',
      nodes: [{ id: 'n1', type: 'stateNode' as const, position: { x: 0, y: 0 }, data }],
      connectors: [],
    });

    expect(DemoSchema.safeParse(baseDemo(baseData)).success).toBe(true);
    expect(
      DemoSchema.safeParse(baseDemo({ ...baseData, handlerModule: 'src/workers/fulfillment.ts' }))
        .success,
    ).toBe(true);
  });
});
