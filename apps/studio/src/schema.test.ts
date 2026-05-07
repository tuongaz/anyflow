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
