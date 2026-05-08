import { describe, expect, it } from 'bun:test';
import {
  type Endpoint,
  getNodeIntersection,
  resolveEdgeEndpoints,
} from '@/lib/floating-edge-geometry';

describe('getNodeIntersection', () => {
  // Standard 100×60 rectangle anchored at the origin so center=(50,30).
  const rect = { x: 0, y: 0, w: 100, h: 60 };

  it('returns side="right" when target is straight to the right', () => {
    const out = getNodeIntersection(rect, { x: 500, y: 30 });
    expect(out.side).toBe('right');
    expect(out.x).toBeCloseTo(100);
    expect(out.y).toBeCloseTo(30);
  });

  it('returns side="left" when target is straight to the left', () => {
    const out = getNodeIntersection(rect, { x: -500, y: 30 });
    expect(out.side).toBe('left');
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(30);
  });

  it('returns side="top" when target is straight above', () => {
    const out = getNodeIntersection(rect, { x: 50, y: -500 });
    expect(out.side).toBe('top');
    expect(out.x).toBeCloseTo(50);
    expect(out.y).toBeCloseTo(0);
  });

  it('returns side="bottom" when target is straight below', () => {
    const out = getNodeIntersection(rect, { x: 50, y: 500 });
    expect(out.side).toBe('bottom');
    expect(out.x).toBeCloseTo(50);
    expect(out.y).toBeCloseTo(60);
  });

  it('returns a deterministic side at the 45° tie (x-axis wins)', () => {
    // Square geometry — halfW === halfH so the |dx|*halfH vs |dy|*halfW tie
    // resolves to the x-axis with the sign of dx.
    const square = { x: 0, y: 0, w: 100, h: 100 };
    expect(getNodeIntersection(square, { x: 200, y: 200 }).side).toBe('right');
    expect(getNodeIntersection(square, { x: -200, y: -200 }).side).toBe('left');
  });

  it('returns a stable fallback (no NaN/Infinity) for degenerate same-center input', () => {
    const out = getNodeIntersection(rect, { x: 50, y: 30 });
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    expect(out.x).toBe(50);
    expect(out.y).toBe(30);
    // Side is documented to fall back to 'right' for stability.
    expect(out.side).toBe('right');
  });

  it('intersection lies on the rectangle perimeter for arbitrary directions', () => {
    // Sample a few off-axis directions and verify the intersection's
    // distance from the center matches the analytic formula (the ray exits
    // at exactly one of the four edges).
    const samples = [
      { x: 200, y: 100 },
      { x: -300, y: 50 },
      { x: 50, y: -90 },
      { x: 75, y: 80 },
    ];
    for (const s of samples) {
      const out = getNodeIntersection(rect, s);
      // Either x is on the left/right edge OR y is on the top/bottom edge
      // (within float tolerance).
      const onVertical = Math.abs(out.x - 0) < 1e-6 || Math.abs(out.x - 100) < 1e-6;
      const onHorizontal = Math.abs(out.y - 0) < 1e-6 || Math.abs(out.y - 60) < 1e-6;
      expect(onVertical || onHorizontal).toBe(true);
    }
  });

  it('honors the rectangle aspect ratio when picking the side', () => {
    // Tall rectangle: 50×200, center (25, 100). A target at (200, 200) is
    // 175 right and 100 down. Aspect: |dx|*halfH = 175*100 = 17500;
    // |dy|*halfW = 100*25 = 2500. Horizontal dominates → 'right'.
    const tall = { x: 0, y: 0, w: 50, h: 200 };
    expect(getNodeIntersection(tall, { x: 200, y: 200 }).side).toBe('right');
    // For the same target relative to a wide rectangle (200×50, center
    // (100,25)), |dx|=100 |dy|=175, halfH=25, halfW=100 →
    // |dx|*halfH=2500, |dy|*halfW=17500 → 'bottom'.
    const wide = { x: 0, y: 0, w: 200, h: 50 };
    expect(getNodeIntersection(wide, { x: 200, y: 200 }).side).toBe('bottom');
  });
});

describe('resolveEdgeEndpoints', () => {
  // Two 100×60 rectangles: A at origin, B at (300, 0) — clear left-of-right
  // geometry that lets the assertions read off the perimeter coords.
  const aBox = { x: 0, y: 0, w: 100, h: 60 };
  const bBox = { x: 300, y: 0, w: 100, h: 60 };
  const aFallback: Endpoint = { x: 50, y: 0, side: 'top' };
  const bFallback: Endpoint = { x: 350, y: 60, side: 'bottom' };

  it('uses perimeter intersections when both endpoints are floating (true)', () => {
    const out = resolveEdgeEndpoints(
      { box: aBox, autoPicked: true, fallback: aFallback },
      { box: bBox, autoPicked: true, fallback: bFallback },
    );
    // A is left of B → A's source endpoint floats out the right edge at
    // (100, 30); B's target endpoint floats out the left edge at (300, 30).
    expect(out.source).toEqual({ x: 100, y: 30, side: 'right' });
    expect(out.target).toEqual({ x: 300, y: 30, side: 'left' });
  });

  it('uses perimeter intersections when both endpoints are floating (undefined → default)', () => {
    // autoPicked: undefined is the migration default — pre-US-021 connectors
    // had no flag at all and must render as floating.
    const out = resolveEdgeEndpoints(
      { box: aBox, autoPicked: undefined, fallback: aFallback },
      { box: bBox, autoPicked: undefined, fallback: bFallback },
    );
    expect(out.source).toEqual({ x: 100, y: 30, side: 'right' });
    expect(out.target).toEqual({ x: 300, y: 30, side: 'left' });
  });

  it('returns the React-Flow fallback for a pinned (autoPicked: false) endpoint', () => {
    // Source pinned, target floating: only the target endpoint moves to the
    // perimeter. The pinned source stays at its fallback coords/side even
    // though the geometry "wants" right, not top.
    const out = resolveEdgeEndpoints(
      { box: aBox, autoPicked: false, fallback: aFallback },
      { box: bBox, autoPicked: true, fallback: bFallback },
    );
    expect(out.source).toEqual(aFallback);
    expect(out.target).toEqual({ x: 300, y: 30, side: 'left' });
  });

  it('handles both endpoints pinned by returning both fallbacks unchanged', () => {
    const out = resolveEdgeEndpoints(
      { box: aBox, autoPicked: false, fallback: aFallback },
      { box: bBox, autoPicked: false, fallback: bFallback },
    );
    expect(out.source).toEqual(aFallback);
    expect(out.target).toEqual(bFallback);
  });

  it('falls back when the source node box is missing', () => {
    // sourceNode hasn't been measured yet — the helper returns the React
    // Flow fallback rather than crashing. Real path: editable-edge passes
    // null when useInternalNode returns undefined. With only one side
    // available, neither endpoint floats (computing the line-through-
    // centers requires both centers), so both endpoints return fallbacks.
    const out = resolveEdgeEndpoints(null, {
      box: bBox,
      autoPicked: true,
      fallback: bFallback,
    });
    // No source input was provided — the helper returns its built-in
    // safe-fallback for the source side.
    expect(out.source.side).toBe('right');
    expect(out.source.x).toBe(0);
    expect(out.source.y).toBe(0);
    expect(out.target).toEqual(bFallback);
  });

  it('falls back when the target node box is missing', () => {
    const out = resolveEdgeEndpoints({ box: aBox, autoPicked: true, fallback: aFallback }, null);
    expect(out.source).toEqual(aFallback);
    expect(out.target.side).toBe('left');
  });
});
