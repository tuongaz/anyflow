import { describe, expect, it } from 'bun:test';
import {
  type GroupableNode,
  computeGroupBbox,
  insertGroupBeforeChildren,
  selectGroupableSet,
  selectUngroupableSet,
  toAbsolutePosition,
  toRelativePosition,
} from '@/lib/group-ops';

const makeNode = (overrides: Partial<GroupableNode> & { id: string }): GroupableNode => ({
  id: overrides.id,
  position: overrides.position ?? { x: 0, y: 0 },
  type: overrides.type ?? 'playNode',
  width: overrides.width,
  height: overrides.height,
  parentId: overrides.parentId,
});

describe('computeGroupBbox', () => {
  it('returns a zero-size bbox at origin for an empty input', () => {
    expect(computeGroupBbox([], 24)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('tight bbox over absolute positions + widths/heights, no padding', () => {
    const nodes = [
      makeNode({ id: 'a', position: { x: 100, y: 200 }, width: 80, height: 40 }),
      makeNode({ id: 'b', position: { x: 300, y: 250 }, width: 50, height: 60 }),
    ];
    expect(computeGroupBbox(nodes, 0)).toEqual({
      x: 100,
      y: 200,
      width: 300 + 50 - 100, // 250
      height: 250 + 60 - 200, // 110
    });
  });

  it('insets by padding on every side', () => {
    const nodes = [makeNode({ id: 'a', position: { x: 0, y: 0 }, width: 100, height: 100 })];
    expect(computeGroupBbox(nodes, 24)).toEqual({
      x: -24,
      y: -24,
      width: 148,
      height: 148,
    });
  });

  it('treats missing width/height as 0 (anchor still pulls the bbox)', () => {
    const nodes = [
      makeNode({ id: 'a', position: { x: 50, y: 60 } }),
      makeNode({ id: 'b', position: { x: 100, y: 200 }, width: 20, height: 20 }),
    ];
    // minX/Y = 50/60; maxX = 100+20 = 120; maxY = 200+20 = 220.
    expect(computeGroupBbox(nodes, 0)).toEqual({
      x: 50,
      y: 60,
      width: 70,
      height: 160,
    });
  });

  it('returns a tight bbox for a single node', () => {
    const nodes = [makeNode({ id: 'a', position: { x: 10, y: 20 }, width: 30, height: 40 })];
    expect(computeGroupBbox(nodes, 0)).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });
});

describe('toRelativePosition / toAbsolutePosition', () => {
  it('round-trips through both', () => {
    const child = { x: 150, y: 220 };
    const parent = { x: 100, y: 200 };
    const relative = toRelativePosition(child, parent);
    expect(relative).toEqual({ x: 50, y: 20 });
    expect(toAbsolutePosition(relative, parent)).toEqual(child);
  });

  it('handles negative offsets (child above/left of parent)', () => {
    const child = { x: -10, y: -20 };
    const parent = { x: 30, y: 40 };
    expect(toRelativePosition(child, parent)).toEqual({ x: -40, y: -60 });
    expect(toAbsolutePosition(toRelativePosition(child, parent), parent)).toEqual(child);
  });
});

describe('selectGroupableSet', () => {
  it('filters out nodes that already have a parentId (no nested grouping)', () => {
    const nodes = [
      makeNode({ id: 'a' }),
      makeNode({ id: 'b', parentId: 'g-existing' }),
      makeNode({ id: 'c' }),
    ];
    expect(selectGroupableSet(['a', 'b', 'c'], nodes)).toEqual(['a', 'c']);
  });

  it("filters out 'group' nodes (groups cannot themselves be wrapped)", () => {
    const nodes = [
      makeNode({ id: 'a' }),
      makeNode({ id: 'g1', type: 'group' }),
      makeNode({ id: 'b' }),
    ];
    expect(selectGroupableSet(['a', 'g1', 'b'], nodes)).toEqual(['a', 'b']);
  });

  it('skips ids that do not resolve to a known node', () => {
    const nodes = [makeNode({ id: 'a' })];
    expect(selectGroupableSet(['a', 'ghost'], nodes)).toEqual(['a']);
  });

  it('preserves input selection order', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' }), makeNode({ id: 'c' })];
    expect(selectGroupableSet(['c', 'a', 'b'], nodes)).toEqual(['c', 'a', 'b']);
  });

  it('returns an empty array when nothing is groupable', () => {
    const nodes = [makeNode({ id: 'a', parentId: 'g' }), makeNode({ id: 'g', type: 'group' })];
    expect(selectGroupableSet(['a', 'g'], nodes)).toEqual([]);
  });
});

describe('selectUngroupableSet', () => {
  it("returns only the 'group' nodes in the selection", () => {
    const nodes = [
      makeNode({ id: 'a' }),
      makeNode({ id: 'g1', type: 'group' }),
      makeNode({ id: 'g2', type: 'group' }),
      makeNode({ id: 'b' }),
    ];
    expect(selectUngroupableSet(['a', 'g1', 'b', 'g2'], nodes)).toEqual(['g1', 'g2']);
  });

  it('returns empty when no group is selected', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' })];
    expect(selectUngroupableSet(['a', 'b'], nodes)).toEqual([]);
  });

  it('skips ids that do not resolve to a known node', () => {
    const nodes = [makeNode({ id: 'g1', type: 'group' })];
    expect(selectUngroupableSet(['g1', 'ghost'], nodes)).toEqual(['g1']);
  });
});

describe('insertGroupBeforeChildren', () => {
  it('puts the group ahead of the earliest child index', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const group = { id: 'g' };
    // Children are b and d → earliest is b at index 1, so g lands at 1.
    expect(insertGroupBeforeChildren(nodes, group, ['b', 'd']).map((n) => n.id)).toEqual([
      'a',
      'g',
      'b',
      'c',
      'd',
    ]);
  });

  it('does not mutate the input array (returns a new one)', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const group = { id: 'g' };
    const next = insertGroupBeforeChildren(nodes, group, ['a']);
    expect(nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(next).not.toBe(nodes);
  });

  it('appends the group when no child is found in the array', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const group = { id: 'g' };
    expect(insertGroupBeforeChildren(nodes, group, ['ghost']).map((n) => n.id)).toEqual([
      'a',
      'b',
      'g',
    ]);
  });

  it('handles a single child at index 0 (group lands at the very front)', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const group = { id: 'g' };
    expect(insertGroupBeforeChildren(nodes, group, ['a']).map((n) => n.id)).toEqual([
      'g',
      'a',
      'b',
    ]);
  });
});
