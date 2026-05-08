import { describe, expect, it } from 'bun:test';
import type { Connector, DemoNode } from '@/lib/api';
import { computeReroutes } from '@/lib/auto-handle-rerouter';

const shape = (id: string, x: number, y: number): DemoNode => ({
  id,
  type: 'shapeNode',
  position: { x, y },
  data: { shape: 'rectangle', width: 100, height: 60 },
});

const conn = (overrides: Partial<Connector>): Connector =>
  ({
    id: 'c1',
    source: 'a',
    target: 'b',
    kind: 'default',
    ...overrides,
  }) as Connector;

describe('computeReroutes', () => {
  it('reroutes the source handle when the target node crosses the diagonal', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 200, 0); // to the right of A
    // Initial connector: source 'r' (a-right), target 'l' (b-left), both auto-picked.
    const c = conn({
      source: 'a',
      target: 'b',
      sourceHandle: 'r',
      targetHandle: 'l',
      sourceHandleAutoPicked: true,
      targetHandleAutoPicked: true,
    });
    // Move B straight below A — facing direction flips from right→down for the
    // source side, and from left→up for the target side.
    const bMoved = shape('b', 0, 200);
    const patches = computeReroutes([a, bMoved], [c]);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.connectorId).toBe('c1');
    expect(patches[0]?.patch.sourceHandle).toBe('b');
    expect(patches[0]?.patch.targetHandle).toBe('t');
  });

  it('does not reroute endpoints with auto-picked = false (user-pinned)', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 0, 200);
    // Same geometry as the diagonal-cross case but neither flag is set —
    // both handles are user-pinned and must stay 'r'/'l' even though the
    // facing direction obviously prefers 'b'/'t'.
    const c = conn({
      source: 'a',
      target: 'b',
      sourceHandle: 'r',
      targetHandle: 'l',
      sourceHandleAutoPicked: false,
      targetHandleAutoPicked: false,
    });
    expect(computeReroutes([a, b], [c])).toEqual([]);
  });

  it('only reroutes the side whose flag is set', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 0, 200); // below A
    // Source flag set, target user-pinned. Only sourceHandle should change.
    const c = conn({
      source: 'a',
      target: 'b',
      sourceHandle: 'r',
      targetHandle: 'l',
      sourceHandleAutoPicked: true,
      targetHandleAutoPicked: false,
    });
    const patches = computeReroutes([a, b], [c]);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.patch.sourceHandle).toBe('b');
    expect(patches[0]?.patch.targetHandle).toBeUndefined();
  });

  it('emits no patch when the recomputed side equals the existing one', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 200, 0); // already to the right of A
    // sourceHandle 'r' is already what the picker would choose. No patch.
    const c = conn({
      source: 'a',
      target: 'b',
      sourceHandle: 'r',
      targetHandle: 'l',
      sourceHandleAutoPicked: true,
      targetHandleAutoPicked: true,
    });
    expect(computeReroutes([a, b], [c])).toEqual([]);
  });

  it('skips connectors that reference unknown nodes', () => {
    const a = shape('a', 0, 0);
    const c = conn({
      source: 'a',
      target: 'missing',
      sourceHandle: 'r',
      targetHandle: 'l',
      sourceHandleAutoPicked: true,
      targetHandleAutoPicked: true,
    });
    expect(computeReroutes([a], [c])).toEqual([]);
  });
});
