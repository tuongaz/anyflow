import { describe, expect, it } from 'bun:test';
import {
  type OverlayInputNode,
  computeNewRectFromAnchorDrag,
  computeSelectionResizeUpdates,
  computeUnionRect,
  selectionEligibleForOverlay,
} from '@/components/selection-resize-overlay';

const node = (
  id: string,
  x: number,
  y: number,
  width?: number,
  height?: number,
  extra: { parentId?: string; locked?: boolean } = {},
): OverlayInputNode => ({
  id,
  position: { x, y },
  parentId: extra.parentId,
  data: { width, height, locked: extra.locked },
});

describe('computeUnionRect', () => {
  it('returns null when no node has measurable size', () => {
    expect(computeUnionRect([node('a', 10, 10), node('b', 50, 50)])).toBeNull();
  });

  it('returns the union of a single sized node', () => {
    expect(computeUnionRect([node('a', 10, 20, 50, 30)])).toEqual({
      x: 10,
      y: 20,
      width: 50,
      height: 30,
    });
  });

  it('returns the union of multiple sized nodes', () => {
    // a at (10, 10) 30×30 → spans (10..40, 10..40)
    // b at (50, 60) 20×40 → spans (50..70, 60..100)
    expect(computeUnionRect([node('a', 10, 10, 30, 30), node('b', 50, 60, 20, 40)])).toEqual({
      x: 10,
      y: 10,
      width: 60,
      height: 90,
    });
  });

  it('skips nodes without width/height', () => {
    // The unsized node is ignored entirely; the sized node defines the rect.
    expect(computeUnionRect([node('a', 0, 0), node('b', 50, 50, 10, 10)])).toEqual({
      x: 50,
      y: 50,
      width: 10,
      height: 10,
    });
  });
});

describe('selectionEligibleForOverlay', () => {
  it('returns false when fewer than 2 nodes are selected', () => {
    expect(selectionEligibleForOverlay([])).toBe(false);
    expect(selectionEligibleForOverlay([node('a', 0, 0, 10, 10)])).toBe(false);
  });

  it('returns true when 2+ loose (parent-less) nodes are selected', () => {
    expect(selectionEligibleForOverlay([node('a', 0, 0, 10, 10), node('b', 50, 50, 10, 10)])).toBe(
      true,
    );
  });

  it('returns false when every selected node shares the same group parent', () => {
    expect(
      selectionEligibleForOverlay([
        node('a', 0, 0, 10, 10, { parentId: 'g' }),
        node('b', 50, 50, 10, 10, { parentId: 'g' }),
      ]),
    ).toBe(false);
  });

  it('returns true when selection mixes a loose node with a grouped child', () => {
    expect(
      selectionEligibleForOverlay([
        node('a', 0, 0, 10, 10),
        node('b', 50, 50, 10, 10, { parentId: 'g' }),
      ]),
    ).toBe(true);
  });

  it('returns true when selection mixes children from different groups', () => {
    expect(
      selectionEligibleForOverlay([
        node('a', 0, 0, 10, 10, { parentId: 'g1' }),
        node('b', 50, 50, 10, 10, { parentId: 'g2' }),
      ]),
    ).toBe(true);
  });
});

describe('computeNewRectFromAnchorDrag', () => {
  const oldRect = { x: 0, y: 0, width: 100, height: 100 };

  it('SE drag — both right edge and bottom edge follow the cursor', () => {
    expect(computeNewRectFromAnchorDrag(oldRect, 'se', 50, 50, false)).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 150,
    });
  });

  it('NW drag — top edge and left edge follow the cursor; SE corner stays', () => {
    expect(computeNewRectFromAnchorDrag(oldRect, 'nw', -20, -10, false)).toEqual({
      x: -20,
      y: -10,
      width: 120,
      height: 110,
    });
  });

  it('E edge drag — only the right edge moves', () => {
    expect(computeNewRectFromAnchorDrag(oldRect, 'e', 30, 999, false)).toEqual({
      x: 0,
      y: 0,
      width: 130,
      height: 100,
    });
  });

  it('aspect-ratio lock uses the smaller scale axis', () => {
    // sx = 1.5 (150/100), sy = 2.0 (200/100); lock → both scale to 1.5
    const out = computeNewRectFromAnchorDrag(oldRect, 'se', 50, 100, true);
    expect(out).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });

  it('aspect-ratio lock anchors the opposite corner when dragging NW', () => {
    // sx = 1.5 (150/100), sy = 2.0 (200/100); lock → both 1.5; SE corner
    // stays anchored at (100,100); NW shifts so the rect is 150×150 ending
    // at (100,100) — i.e. starts at (-50, -50).
    const out = computeNewRectFromAnchorDrag(oldRect, 'nw', -50, -100, true);
    expect(out).toEqual({ x: -50, y: -50, width: 150, height: 150 });
  });

  it('clamps degenerate (collapsed) rects to a 1px floor on each axis', () => {
    // SE drag inward past the opposing edge: width should clamp to 1, not
    // flip to negative (the scale factor would invert otherwise).
    const out = computeNewRectFromAnchorDrag(oldRect, 'se', -200, -200, false);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
  });
});

describe('computeSelectionResizeUpdates', () => {
  it('returns position + size for each scaled node', () => {
    const updates = computeSelectionResizeUpdates(
      [node('a', 10, 10, 20, 20), node('b', 50, 50, 20, 20)],
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    );
    expect(updates).toEqual([
      { id: 'a', position: { x: 20, y: 20 }, width: 40, height: 40 },
      { id: 'b', position: { x: 100, y: 100 }, width: 40, height: 40 },
    ]);
  });

  it('filters out locked nodes (no PATCH for a node that didn’t move)', () => {
    const updates = computeSelectionResizeUpdates(
      [node('a', 10, 10, 20, 20), node('b', 50, 50, 20, 20, { locked: true })],
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    );
    expect(updates).toEqual([{ id: 'a', position: { x: 20, y: 20 }, width: 40, height: 40 }]);
  });

  it('passes lockAspectRatio through to scaleNodesWithinRect', () => {
    // sx = 2 (200/100), sy = 4 (400/100); lock → 2 for both axes; the b node
    // at (50, 50) scales to (100, 100), and its 20×20 size becomes 40×40
    // — NOT 80×80 (which is what a free 4× scale on y would produce).
    const updates = computeSelectionResizeUpdates(
      [node('b', 50, 50, 20, 20)],
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 400 },
      { lockAspectRatio: true },
    );
    expect(updates[0]?.width).toBe(40);
    expect(updates[0]?.height).toBe(40);
  });

  it('emits position-only updates when source nodes have no width/height', () => {
    const updates = computeSelectionResizeUpdates(
      [node('a', 10, 10), node('b', 50, 50)],
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    );
    expect(updates).toEqual([
      { id: 'a', position: { x: 20, y: 20 } },
      { id: 'b', position: { x: 100, y: 100 } },
    ]);
  });
});
