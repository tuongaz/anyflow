import { describe, expect, it } from 'bun:test';
import {
  applyDragToPolyline,
  curvePathWithMidpoint,
  defaultCurveMidpoint,
  quadraticControlFromMidpoint,
  stepPathWithWaypoints,
} from './waypoint-paths';

const evalQuadraticBezier = (
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  t: number,
): { x: number; y: number } => {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
};

describe('quadraticControlFromMidpoint', () => {
  it('returns a control such that the curve passes through the midpoint at t=0.5', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    const midpoint = { x: 50, y: 40 };
    const control = quadraticControlFromMidpoint(start, midpoint, end);
    const onCurve = evalQuadraticBezier(start, control, end, 0.5);
    expect(onCurve.x).toBeCloseTo(midpoint.x, 6);
    expect(onCurve.y).toBeCloseTo(midpoint.y, 6);
  });

  it('works for diagonal endpoints', () => {
    const start = { x: 10, y: 10 };
    const end = { x: 200, y: 80 };
    const midpoint = { x: 100, y: 90 };
    const control = quadraticControlFromMidpoint(start, midpoint, end);
    const onCurve = evalQuadraticBezier(start, control, end, 0.5);
    expect(onCurve.x).toBeCloseTo(midpoint.x, 6);
    expect(onCurve.y).toBeCloseTo(midpoint.y, 6);
  });
});

describe('curvePathWithMidpoint', () => {
  it('emits a quadratic bezier (Q) when a midpoint is supplied', () => {
    const result = curvePathWithMidpoint({ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 });
    expect(result.d).toMatch(/^M\s.*\sQ\s/);
    expect(result.labelX).toBe(50);
    expect(result.labelY).toBe(40);
    expect(result.anchor.x).toBe(50);
    expect(result.anchor.y).toBe(40);
    expect(result.anchor.axis).toBe('free');
  });

  it('falls back to a straight line + chord midpoint anchor when no waypoint', () => {
    const result = curvePathWithMidpoint({ x: 0, y: 0 }, null, { x: 100, y: 60 });
    expect(result.d).toMatch(/^M\s.*\sL\s/);
    const mid = defaultCurveMidpoint({ x: 0, y: 0 }, { x: 100, y: 60 });
    expect(result.anchor.x).toBeCloseTo(mid.x, 6);
    expect(result.anchor.y).toBeCloseTo(mid.y, 6);
  });
});

describe('stepPathWithWaypoints', () => {
  it('synthesizes a 3-segment polyline with no stored waypoints (horizontal-facing endpoints)', () => {
    const result = stepPathWithWaypoints({ x: 0, y: 0, side: 'right' }, [], {
      x: 100,
      y: 100,
      side: 'left',
    });
    // Default routing for two horizontal handles routes through midX so the
    // polyline runs H → V → H. With rounded corners we emit L commands plus
    // arcs at each interior corner rather than literal H/V tokens.
    expect(result.d.startsWith('M ')).toBe(true);
    expect(result.d).toContain('L ');
    expect(result.d).toContain('A ');
    expect(result.anchors.length).toBeGreaterThanOrEqual(2);
    // Every anchor reports a horizontal or vertical axis (no 'free' for step).
    for (const a of result.anchors) {
      expect(a.axis === 'horizontal' || a.axis === 'vertical').toBe(true);
    }
  });

  it('walks through stored corner waypoints in order with rounded corners', () => {
    const result = stepPathWithWaypoints(
      { x: 0, y: 0, side: 'right' },
      [
        { x: 50, y: 0 },
        { x: 50, y: 80 },
      ],
      { x: 120, y: 80, side: 'left' },
    );
    // Path must start at the source and visit each waypoint coordinate. With
    // rounded corners we step back from each vertex before an arc and step
    // forward after — so the raw vertex coords appear via the arc endpoints
    // rather than as literal H/V tokens.
    expect(result.d.startsWith('M 0,0')).toBe(true);
    // Polyline indices: source(0) → c0(1) → c1(2) → target(3).
    expect(result.polyline.length).toBe(4);
    expect(result.polyline[0]).toEqual({ x: 0, y: 0 });
    expect(result.polyline[1]).toEqual({ x: 50, y: 0 });
    expect(result.polyline[2]).toEqual({ x: 50, y: 80 });
    expect(result.polyline[3]).toEqual({ x: 120, y: 80 });
    // Rounded → SVG arc commands appear at each interior corner (2 corners).
    expect((result.d.match(/A\s/g) ?? []).length).toBe(2);
  });

  it('reports anchors at segment midpoints with the correct drag axis and polyline indices', () => {
    const result = stepPathWithWaypoints(
      { x: 0, y: 0, side: 'right' },
      [
        { x: 50, y: 0 },
        { x: 50, y: 80 },
      ],
      { x: 120, y: 80, side: 'left' },
    );
    // First segment (0,0) → (50,0) is horizontal → drag axis is vertical.
    const first = result.anchors[0];
    expect(first?.axis).toBe('vertical');
    expect(first?.x).toBe(25);
    expect(first?.y).toBe(0);
    expect(first?.polyline).toEqual({ a: 0, b: 1 });
    // Middle segment (50,0) → (50,80) is vertical → drag axis is horizontal.
    const mid = result.anchors[1];
    expect(mid?.axis).toBe('horizontal');
    expect(mid?.x).toBe(50);
    expect(mid?.y).toBe(40);
    expect(mid?.polyline).toEqual({ a: 1, b: 2 });
  });
});

describe('applyDragToPolyline', () => {
  it('moves both endpoints of an interior segment along the perpendicular axis', () => {
    // Polyline source(0) → c0(50,0) → c1(50,80) → target(120,80).
    const polyline = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 80 },
      { x: 120, y: 80 },
    ];
    const anchor = {
      x: 50,
      y: 40,
      axis: 'horizontal' as const,
      segment: { a: 0, b: 1 },
      polyline: { a: 1, b: 2 },
    };
    // Drag horizontally by +30 → vertical segment slides right.
    const next = applyDragToPolyline(polyline, anchor, 30, 999);
    // Endpoints stripped, only inner waypoints persist.
    expect(next).toEqual([
      { x: 80, y: 0 },
      { x: 80, y: 80 },
    ]);
  });

  it('insert a corner near the source when an endpoint-adjacent segment is dragged', () => {
    // Source-adjacent segment from (0,0) to (50,0) — horizontal → drag axis is
    // vertical. Without insertion, dragging would skew the segment. We expect
    // a new corner inserted at the source so the segment can move orthogonally.
    const polyline = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 80 },
      { x: 120, y: 80 },
    ];
    const anchor = {
      x: 25,
      y: 0,
      axis: 'vertical' as const,
      segment: { a: null, b: 0 },
      polyline: { a: 0, b: 1 },
    };
    const next = applyDragToPolyline(polyline, anchor, 0, 30);
    // New corner inserted at source (0,0) BEFORE the dragged segment. The
    // previously-c0 corner (50,0) moves to (50, 30) along the drag axis. The
    // inserted source-copy at index 1 (originally 0,0) also moves because it
    // sits between endpoints — that's the new corner.
    // Resulting inner waypoints: [{0,30}, {50,30}, {50,80}].
    expect(next).toEqual([
      { x: 0, y: 30 },
      { x: 50, y: 30 },
      { x: 50, y: 80 },
    ]);
  });

  it('moves a single waypoint when both anchor ends point at the same polyline index', () => {
    // Curve case: polyline = [start, midpoint, end]; anchor.polyline.a === .b.
    const polyline = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
    ];
    const anchor = {
      x: 50,
      y: 50,
      axis: 'free' as const,
      segment: { a: 0, b: 0 },
      polyline: { a: 1, b: 1 },
    };
    const next = applyDragToPolyline(polyline, anchor, 10, 20);
    // Delta applied ONCE (deduped) → midpoint shifts by (10, 20).
    expect(next).toEqual([{ x: 60, y: 70 }]);
  });
});
