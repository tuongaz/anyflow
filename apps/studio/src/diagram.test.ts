import { describe, expect, test } from 'bun:test';
import { assembleDemo } from './diagram.ts';

// Mirror the defaults in diagram.ts so tests can reason about overlap purely
// from output positions. If the layout constants drift, these helpers come
// along with them and the overlap assertions stay meaningful.
const DEFAULT_W = 200;
const DEFAULT_H = 120;
const dims = (n: { type?: string; data?: { width?: number; height?: number; shape?: string } }) => {
  const data = n.data ?? {};
  const w =
    typeof data.width === 'number'
      ? data.width
      : n.type === 'shapeNode' && data.shape === 'text'
        ? 160
        : DEFAULT_W;
  let h = DEFAULT_H;
  if (typeof data.height === 'number') h = data.height;
  else if (n.type === 'shapeNode' && data.shape === 'text') h = 40;
  else if (n.type === 'shapeNode' && data.shape === 'sticky') h = 180;
  else if (n.type === 'imageNode') h = 150;
  return { w, h };
};

interface OutNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data?: { width?: number; height?: number; shape?: string };
}

const rectsOverlap = (a: OutNode, b: OutNode): boolean => {
  const da = dims(a);
  const db = dims(b);
  const ax2 = a.position.x + da.w;
  const ay2 = a.position.y + da.h;
  const bx2 = b.position.x + db.w;
  const by2 = b.position.y + db.h;
  return a.position.x < bx2 && ax2 > b.position.x && a.position.y < by2 && ay2 > b.position.y;
};

const playNode = (id: string, x = 0, y = 0) => ({
  id,
  type: 'playNode',
  position: { x, y },
  data: {
    label: id,
    kind: 'service',
    stateSource: { kind: 'request' as const },
    playAction: { kind: 'http' as const, method: 'GET' as const, url: `http://x/${id}` },
  },
});

const stateNode = (id: string, x = 0, y = 0) => ({
  id,
  type: 'stateNode',
  position: { x, y },
  data: { label: id, kind: 'store', stateSource: { kind: 'request' as const } },
});

const connector = (source: string, target: string) => ({
  id: `${source}-${target}`,
  source,
  target,
  kind: 'http' as const,
});

describe('assembleDemo auto-layout', () => {
  test('clustered LLM positions are reflowed so no two nodes overlap', () => {
    const result = assembleDemo({
      wiring: {
        nodes: [
          // All five within 60px of each other — would all overlap under the
          // old exact-position breakOverlap.
          playNode('a', 0, 0),
          stateNode('b', 24, 24),
          stateNode('c', 48, 48),
          stateNode('d', 24, 72),
          stateNode('e', 48, 24),
        ],
        connectors: [
          connector('a', 'b'),
          connector('b', 'c'),
          connector('a', 'd'),
          connector('d', 'e'),
        ],
      },
    });

    const out = result.demo.nodes as unknown as OutNode[];
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const ni = out[i];
        const nj = out[j];
        if (!ni || !nj) continue;
        expect(rectsOverlap(ni, nj)).toBe(false);
      }
    }
  });

  test('linear chain A→B→C lays out left-to-right with widening x and same y', () => {
    const result = assembleDemo({
      wiring: {
        nodes: [playNode('A', 0, 0), stateNode('B', 0, 0), stateNode('C', 0, 0)],
        connectors: [connector('A', 'B'), connector('B', 'C')],
      },
    });
    const out = result.demo.nodes as unknown as OutNode[];
    const byId = new Map(out.map((n) => [n.id, n]));
    const a = byId.get('a');
    const b = byId.get('b');
    const c = byId.get('c');
    if (!a || !b || !c) throw new Error('missing chain node');
    expect(a.position.x).toBeLessThan(b.position.x);
    expect(b.position.x).toBeLessThan(c.position.x);
    expect(a.position.y).toBe(b.position.y);
    expect(b.position.y).toBe(c.position.y);
  });

  test('connectors are long enough to fit label text (>= ~120px between rectangles)', () => {
    const result = assembleDemo({
      wiring: {
        nodes: [playNode('A', 0, 0), stateNode('B', 0, 0)],
        connectors: [connector('A', 'B')],
      },
    });
    const [a, b] = result.demo.nodes as unknown as OutNode[];
    if (!a || !b) throw new Error('missing nodes');
    // A is at x=0 width 200; B's left edge minus A's right edge must leave
    // room for a connector label of typical width.
    const gap = b.position.x - (a.position.x + dims(a).w);
    expect(gap).toBeGreaterThanOrEqual(120);
  });

  test('fan-out parent → C1/C2/C3 places children in the same column, distinct rows', () => {
    const result = assembleDemo({
      wiring: {
        nodes: [
          playNode('P', 0, 0),
          stateNode('C1', 0, 0),
          stateNode('C2', 0, 0),
          stateNode('C3', 0, 0),
        ],
        connectors: [connector('P', 'C1'), connector('P', 'C2'), connector('P', 'C3')],
      },
    });
    const byId = new Map((result.demo.nodes as unknown as OutNode[]).map((n) => [n.id, n]));
    const c1 = byId.get('c1');
    const c2 = byId.get('c2');
    const c3 = byId.get('c3');
    if (!c1 || !c2 || !c3) throw new Error('missing child');
    expect(c1.position.x).toBe(c2.position.x);
    expect(c2.position.x).toBe(c3.position.x);
    expect(new Set([c1.position.y, c2.position.y, c3.position.y]).size).toBe(3);
  });

  test('two disconnected components occupy disjoint vertical bands', () => {
    const result = assembleDemo({
      wiring: {
        nodes: [
          playNode('A1', 0, 0),
          stateNode('A2', 0, 0),
          playNode('B1', 0, 0),
          stateNode('B2', 0, 0),
        ],
        connectors: [connector('A1', 'A2'), connector('B1', 'B2')],
      },
    });
    const byId = new Map((result.demo.nodes as unknown as OutNode[]).map((n) => [n.id, n]));
    const a1 = byId.get('a1');
    const a2 = byId.get('a2');
    const b1 = byId.get('b1');
    const b2 = byId.get('b2');
    if (!a1 || !a2 || !b1 || !b2) throw new Error('missing component node');
    const aBottom = Math.max(a1.position.y + dims(a1).h, a2.position.y + dims(a2).h);
    const bTop = Math.min(b1.position.y, b2.position.y);
    expect(bTop).toBeGreaterThanOrEqual(aBottom);
  });

  test('cycles do not crash and produce a layered layout', () => {
    const result = assembleDemo({
      wiring: {
        nodes: [playNode('A', 0, 0), stateNode('B', 0, 0), stateNode('C', 0, 0)],
        // A -> B -> C -> A
        connectors: [connector('A', 'B'), connector('B', 'C'), connector('C', 'A')],
      },
    });
    expect(result.demo.nodes).toHaveLength(3);
    const out = result.demo.nodes as unknown as OutNode[];
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const ni = out[i];
        const nj = out[j];
        if (!ni || !nj) continue;
        expect(rectsOverlap(ni, nj)).toBe(false);
      }
    }
  });

  test('all output positions are on the 24px grid', () => {
    const result = assembleDemo({
      wiring: {
        nodes: [
          playNode('A', 11, 23),
          stateNode('B', 17, 41),
          stateNode('C', 23, 59),
          stateNode('D', 29, 77),
        ],
        connectors: [connector('A', 'B'), connector('B', 'C'), connector('A', 'D')],
      },
    });
    for (const n of result.demo.nodes as unknown as OutNode[]) {
      expect(n.position.x % 24).toBe(0);
      expect(n.position.y % 24).toBe(0);
    }
  });

  test('sticky and text shape nodes keep their input position (floating annotations)', () => {
    const result = assembleDemo({
      wiring: {
        nodes: [
          playNode('A', 0, 0),
          stateNode('B', 0, 0),
          {
            id: 'note',
            type: 'shapeNode',
            position: { x: -1200, y: -720 },
            data: { shape: 'sticky', label: 'Reminder' },
          },
          {
            id: 'caption',
            type: 'shapeNode',
            position: { x: 1440, y: 600 },
            data: { shape: 'text', label: 'caption' },
          },
        ],
        connectors: [connector('A', 'B')],
      },
    });
    const byId = new Map((result.demo.nodes as unknown as OutNode[]).map((n) => [n.id, n]));
    expect(byId.get('note')?.position).toEqual({ x: -1200, y: -720 });
    expect(byId.get('caption')?.position).toEqual({ x: 1440, y: 600 });
  });

  test('within a layer, sibling nodes preserve the input y ordering', () => {
    const result = assembleDemo({
      wiring: {
        nodes: [
          playNode('P', 0, 0),
          stateNode('top', 0, -500),
          stateNode('mid', 0, 0),
          stateNode('bot', 0, 500),
        ],
        connectors: [connector('P', 'top'), connector('P', 'mid'), connector('P', 'bot')],
      },
    });
    const byId = new Map((result.demo.nodes as unknown as OutNode[]).map((n) => [n.id, n]));
    const top = byId.get('top');
    const mid = byId.get('mid');
    const bot = byId.get('bot');
    if (!top || !mid || !bot) throw new Error('missing sibling');
    expect(top.position.y).toBeLessThan(mid.position.y);
    expect(mid.position.y).toBeLessThan(bot.position.y);
  });

  test('single-node graph still honors an explicit layout position', () => {
    const result = assembleDemo({
      wiring: {
        nodes: [{ id: 'n1', position: { x: 0, y: 0 } }],
        connectors: [],
      },
      layout: { positions: { n1: { x: 240, y: 480 } } },
    });
    expect((result.demo.nodes[0] as { position: { x: number; y: number } }).position).toEqual({
      x: 240,
      y: 480,
    });
  });
});
