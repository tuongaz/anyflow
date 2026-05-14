/**
 * US-027: waypoint-aware path generation for connectors.
 *
 * Two routing models share this module:
 *   • `curvePathWithMidpoint` — quadratic bezier through a single mid-anchor.
 *     The control point is chosen so the curve passes through the dragged
 *     midpoint at t = 0.5 (the bezier midpoint formula
 *     `B(0.5) = 0.25 * (P0 + 2 * P1 + P2)` solved for P1).
 *   • `stepPathWithWaypoints` — orthogonal polyline that walks from source
 *     through every interior waypoint to the target. The first segment exits
 *     the source perpendicular to its side; we alternate H/V between
 *     consecutive points and inject an L-corner when the direction can't be
 *     met directly.
 *
 * Both helpers also report segment anchors — the points + per-segment
 * orientation a draggable mid-anchor handle should sit on. `editable-edge.tsx`
 * walks those anchors to render the visible drag handles.
 */
export interface XY {
  x: number;
  y: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface SegmentAnchor {
  /** Mid-segment position in flow coords. */
  x: number;
  y: number;
  /**
   * Constrained-drag axis. 'horizontal' = drag along X (segment is vertical);
   * 'vertical' = drag along Y (segment is horizontal); 'free' = either axis.
   */
  axis: 'horizontal' | 'vertical' | 'free';
  /**
   * Which two waypoints (by index in the connector's stored waypoint array)
   * this anchor moves when dragged. `null` ends mean "the segment endpoint
   * is the edge's source/target endpoint, not a waypoint" — those endpoints
   * stay put; only stored waypoints get updated.
   */
  segment: { a: number | null; b: number | null };
  /**
   * US-027: the index, within the EXPANDED polyline (source + visible
   * corners + target), of this anchor's segment endpoints. The drag handler
   * uses these to identify which positions in the visible polyline to
   * translate by the drag delta — important for the default-routing case
   * where no waypoints are stored yet but the visible polyline still has
   * synthesized corners that need to be promoted.
   */
  polyline: { a: number; b: number };
}

export interface CurveResult {
  /** SVG path data (`M ... Q ... ...`). */
  d: string;
  /** Label anchor (matches the bezier midpoint, t = 0.5). */
  labelX: number;
  labelY: number;
  /** Single mid-anchor — the user-controlled waypoint (or computed default). */
  anchor: SegmentAnchor;
}

export interface StepResult {
  /** SVG path data with `H`/`V` segments. */
  d: string;
  /** Label anchor (midpoint of the polyline by arclength). */
  labelX: number;
  labelY: number;
  /** One anchor per orthogonal segment, in order from source to target. */
  anchors: SegmentAnchor[];
  /**
   * The expanded polyline (source, every corner, target) the path walks.
   * Drag handlers use this as the starting point for translating segment
   * endpoints; the new waypoints are produced by stripping the source and
   * target out of the dragged polyline.
   */
  polyline: XY[];
}

const MID = 0.5;

/**
 * Compute a quadratic-bezier control point so the curve passes through
 * `midpoint` at t = 0.5.
 *
 * Bezier midpoint: `B(0.5) = 0.25 * P0 + 0.5 * P1 + 0.25 * P2`.
 * Solve for P1: `P1 = 2 * B(0.5) - 0.5 * (P0 + P2)`.
 */
export const quadraticControlFromMidpoint = (start: XY, midpoint: XY, end: XY): XY => ({
  x: 2 * midpoint.x - MID * (start.x + end.x),
  y: 2 * midpoint.y - MID * (start.y + end.y),
});

/**
 * Default midpoint for a curve when no waypoint is stored. Falls back to the
 * chord midpoint so the visible anchor sits on the straight line between
 * endpoints — close enough to where a fresh bezier would render.
 */
export const defaultCurveMidpoint = (start: XY, end: XY): XY => ({
  x: (start.x + end.x) * MID,
  y: (start.y + end.y) * MID,
});

/**
 * Build a quadratic-bezier path through an optional mid-anchor. With no
 * `midpoint`, draws a straight line — the caller can also delegate back to
 * React Flow's `getBezierPath` for the default-routing case.
 */
export const curvePathWithMidpoint = (start: XY, midpoint: XY | null, end: XY): CurveResult => {
  if (midpoint === null) {
    const mid = defaultCurveMidpoint(start, end);
    return {
      d: `M ${start.x},${start.y} L ${end.x},${end.y}`,
      labelX: mid.x,
      labelY: mid.y,
      // The conceptual polyline is [start, midpoint, end] (3 points). The
      // anchor sits at the midpoint (index 1); both segment ends collapse to
      // that index so applyDragToPolyline applies the delta once and produces
      // a single stored waypoint at the dragged position.
      anchor: {
        x: mid.x,
        y: mid.y,
        axis: 'free',
        segment: { a: null, b: null },
        polyline: { a: 1, b: 1 },
      },
    };
  }
  const control = quadraticControlFromMidpoint(start, midpoint, end);
  return {
    d: `M ${start.x},${start.y} Q ${control.x},${control.y} ${end.x},${end.y}`,
    labelX: midpoint.x,
    labelY: midpoint.y,
    anchor: {
      x: midpoint.x,
      y: midpoint.y,
      axis: 'free',
      segment: { a: 0, b: 0 },
      polyline: { a: 1, b: 1 },
    },
  };
};

const sideAxis = (side: Side): 'horizontal' | 'vertical' =>
  side === 'left' || side === 'right' ? 'horizontal' : 'vertical';

/**
 * US-027: corner-rounding radius for step paths. Matches the constant
 * EditableEdge uses when falling back to React Flow's `getSmoothStepPath` for
 * an unselected step edge — so the visible chrome stays consistent whether
 * the path is generated via the waypoint module or via React Flow's helper.
 */
export const STEP_CORNER_RADIUS = 8;

const lengthOf = (dx: number, dy: number): number => Math.sqrt(dx * dx + dy * dy);

/**
 * Walk an array of polyline points and produce an SVG path string with
 * rounded corners at every interior vertex. Two consecutive points must
 * share either X or Y (axis-aligned) — diagonal segments are NOT supported
 * here; callers should run their input through `expandStepPoints` which
 * splits diagonals into two axis-aligned segments via an L-elbow.
 *
 * Rounding: at each interior corner we replace the sharp vertex with a
 * quarter-arc of radius `STEP_CORNER_RADIUS`, clamped to half the shorter
 * adjacent segment so the arc never overflows past the segment midpoint.
 */
const polylineToOrthogonalD = (points: XY[]): string => {
  // Collapse adjacent duplicates and skip degenerate segments before we
  // start emitting commands. This is also the gate that drops zero-length
  // segments synthesized by `expandStepPoints` when the default corners
  // happen to coincide with an endpoint.
  const pts: XY[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) pts.push(p);
  }
  const first = pts[0];
  if (!first) return '';
  if (pts.length === 1) return `M ${first.x},${first.y}`;
  if (pts.length === 2) {
    const next = pts[1];
    if (!next) return `M ${first.x},${first.y}`;
    return `M ${first.x},${first.y} L ${next.x},${next.y}`;
  }
  const cmds: string[] = [`M ${first.x},${first.y}`];
  for (let i = 1; i < pts.length; i += 1) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    if (!prev || !cur) continue;
    // Last segment → straight line to the final point.
    if (!next) {
      cmds.push(`L ${cur.x},${cur.y}`);
      continue;
    }
    // Interior corner — round it. Clamp the arc radius to half of each
    // adjacent segment so we never overflow into the next corner.
    const incomingLen = lengthOf(cur.x - prev.x, cur.y - prev.y);
    const outgoingLen = lengthOf(next.x - cur.x, next.y - cur.y);
    const r = Math.min(STEP_CORNER_RADIUS, incomingLen / 2, outgoingLen / 2);
    if (r <= 0) {
      // Adjacent segment degenerate — skip the arc and connect straight.
      cmds.push(`L ${cur.x},${cur.y}`);
      continue;
    }
    // Step-back point on the incoming segment, before the corner.
    const enterDx = cur.x - prev.x === 0 ? 0 : (cur.x - prev.x) / incomingLen;
    const enterDy = cur.y - prev.y === 0 ? 0 : (cur.y - prev.y) / incomingLen;
    const arcStart = { x: cur.x - enterDx * r, y: cur.y - enterDy * r };
    // Step-forward point on the outgoing segment, past the corner.
    const exitDx = next.x - cur.x === 0 ? 0 : (next.x - cur.x) / outgoingLen;
    const exitDy = next.y - cur.y === 0 ? 0 : (next.y - cur.y) / outgoingLen;
    const arcEnd = { x: cur.x + exitDx * r, y: cur.y + exitDy * r };
    // Sweep flag: 1 if the turn is clockwise (cross product positive),
    // 0 otherwise. SVG's arc sweep direction is in screen-space (y grows
    // downward), so a clockwise turn in flow coords IS sweep=1.
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    const sweep = cross > 0 ? 1 : 0;
    cmds.push(`L ${arcStart.x},${arcStart.y}`);
    cmds.push(`A ${r},${r} 0 0 ${sweep} ${arcEnd.x},${arcEnd.y}`);
  }
  return cmds.join(' ');
};

/**
 * Expand source + stored waypoints + target into the actual sequence of
 * polyline corners the renderer walks. When a pair of consecutive points
 * isn't axis-aligned, an implicit corner is inserted (with its elbow
 * direction chosen to alternate axes), and that corner is reported as a
 * "virtual" anchor (segment indices reflect the surrounding waypoints).
 *
 * The implicit corners are NOT persisted — they're derived from neighboring
 * waypoints. When the user drags an implicit corner, we promote it: the drag
 * commits as a new stored waypoint at that position so the user can move it
 * freely afterward.
 */
interface ExpandedPoint {
  point: XY;
  /**
   * The stored-waypoint index this point corresponds to, or null if it's
   * the edge endpoint, or { promoteAt: i } if it's an implicit elbow corner
   * that should be inserted at index `i` of the waypoints array when dragged.
   */
  origin:
    | { kind: 'endpoint' }
    | { kind: 'stored'; index: number }
    | { kind: 'implicit'; before: number };
}

const expandStepPoints = (
  sourceSide: Side,
  source: XY,
  waypoints: XY[],
  target: XY,
): ExpandedPoint[] => {
  const out: ExpandedPoint[] = [{ point: source, origin: { kind: 'endpoint' } }];
  let prev = source;
  let prevAxis: 'horizontal' | 'vertical' = sideAxis(sourceSide);
  // The first segment leaves the source perpendicular to its side: if the
  // source side is left/right (horizontal axis), the first segment is
  // horizontal; for top/bottom it's vertical.
  for (let i = 0; i < waypoints.length; i += 1) {
    const wp = waypoints[i];
    if (!wp) continue;
    const dx = wp.x - prev.x;
    const dy = wp.y - prev.y;
    if ((dx === 0 && dy === 0) || dx === 0 || dy === 0) {
      out.push({ point: wp, origin: { kind: 'stored', index: i } });
      if (dx === 0 && dy !== 0) prevAxis = 'vertical';
      else if (dy === 0 && dx !== 0) prevAxis = 'horizontal';
      prev = wp;
      continue;
    }
    // Implicit elbow corner between prev and wp. Elbow lies along the axis
    // opposite of the previous segment so we alternate H/V.
    const elbow: XY = prevAxis === 'horizontal' ? { x: wp.x, y: prev.y } : { x: prev.x, y: wp.y };
    out.push({ point: elbow, origin: { kind: 'implicit', before: i } });
    out.push({ point: wp, origin: { kind: 'stored', index: i } });
    prevAxis = prevAxis === 'horizontal' ? 'vertical' : 'horizontal';
    prev = wp;
  }
  // Final leg to the target: insert an elbow if needed.
  const dxFinal = target.x - prev.x;
  const dyFinal = target.y - prev.y;
  if ((dxFinal !== 0 && dyFinal !== 0) || (dxFinal === 0 && dyFinal === 0)) {
    if (dxFinal !== 0 && dyFinal !== 0) {
      const elbow: XY =
        prevAxis === 'horizontal' ? { x: target.x, y: prev.y } : { x: prev.x, y: target.y };
      out.push({ point: elbow, origin: { kind: 'implicit', before: waypoints.length } });
    }
  }
  out.push({ point: target, origin: { kind: 'endpoint' } });
  return out;
};

/**
 * Default smoothstep-equivalent corners for a step path with no stored
 * waypoints. Produces 2 corners so the result is a 3-segment zigzag (the
 * familiar React-Flow smoothstep look). We pick corners by averaging the
 * source/target on the axis perpendicular to the source side.
 *
 * If both endpoints face the same axis (e.g. both right-side handles), we
 * still emit two corners by routing through the midpoint of the perpendicular
 * axis so the path has visible bends.
 */
const defaultStepCorners = (sourceSide: Side, source: XY, targetSide: Side, target: XY): XY[] => {
  const sAxis = sideAxis(sourceSide);
  const tAxis = sideAxis(targetSide);
  // Both horizontal → run out, jog vertically at midX, run in.
  if (sAxis === 'horizontal' && tAxis === 'horizontal') {
    const midX = (source.x + target.x) * MID;
    return [
      { x: midX, y: source.y },
      { x: midX, y: target.y },
    ];
  }
  if (sAxis === 'vertical' && tAxis === 'vertical') {
    const midY = (source.y + target.y) * MID;
    return [
      { x: source.x, y: midY },
      { x: target.x, y: midY },
    ];
  }
  // Mixed axes → one corner suffices but we keep two so the path always has
  // the same shape (and one of the segments can degenerate to zero length,
  // which polylineToOrthogonalD filters out).
  if (sAxis === 'horizontal') {
    return [{ x: target.x, y: source.y }];
  }
  return [{ x: source.x, y: target.y }];
};

/**
 * Build an orthogonal path from source to target through `waypoints`. When
 * `waypoints` is empty we synthesize 2 default corners so the result looks
 * like React Flow's smoothstep. Each segment in the resulting polyline has
 * an anchor at its midpoint; the anchor's drag axis is perpendicular to the
 * segment (drag-an-H-segment moves the segment's Y; drag-a-V-segment moves
 * its X). Endpoints aren't dragged — only stored waypoints are updated.
 */
export const stepPathWithWaypoints = (
  source: XY & { side: Side },
  waypoints: XY[],
  target: XY & { side: Side },
): StepResult => {
  const effective =
    waypoints.length === 0
      ? defaultStepCorners(source.side, source, target.side, target)
      : waypoints;
  const sourceXY: XY = { x: source.x, y: source.y };
  const targetXY: XY = { x: target.x, y: target.y };
  const points = expandStepPoints(source.side, sourceXY, effective, targetXY);
  // Strip any side metadata that came in on the endpoints so the polyline
  // is pure XY pairs the drag/persistence path can consume.
  const polyline: XY[] = points.map((p) => ({ x: p.point.x, y: p.point.y }));
  const d = polylineToOrthogonalD(polyline);

  // Build segment anchors at the midpoint of each consecutive pair.
  const anchors: SegmentAnchor[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const dx = b.point.x - a.point.x;
    const dy = b.point.y - a.point.y;
    // Skip zero-length segments (collinear consecutive points).
    if (dx === 0 && dy === 0) continue;
    const mx = (a.point.x + b.point.x) * MID;
    const my = (a.point.y + b.point.y) * MID;
    // Segment axis: horizontal segment (dy === 0) drags vertically; vertical
    // (dx === 0) drags horizontally; diagonal (shouldn't happen for step) is free.
    const axis: 'horizontal' | 'vertical' | 'free' =
      dy === 0 && dx !== 0 ? 'vertical' : dx === 0 && dy !== 0 ? 'horizontal' : 'free';
    // Map a/b origins back to stored-waypoint indices. Endpoint and implicit
    // origins return `null` so the drag handler can splice a fresh waypoint
    // in (via the polyline indices below).
    const originToSegmentEnd = (origin: ExpandedPoint['origin']): number | null => {
      if (origin.kind === 'stored') return origin.index;
      return null;
    };
    anchors.push({
      x: mx,
      y: my,
      axis,
      segment: { a: originToSegmentEnd(a.origin), b: originToSegmentEnd(b.origin) },
      polyline: { a: i - 1, b: i },
    });
  }

  // Label sits at the midpoint of the longest segment so the badge has the
  // best chance of fitting without overlapping a bend.
  let bestLen = -1;
  let labelX = (source.x + target.x) * MID;
  let labelY = (source.y + target.y) * MID;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const len = Math.abs(b.point.x - a.point.x) + Math.abs(b.point.y - a.point.y);
    if (len > bestLen) {
      bestLen = len;
      labelX = (a.point.x + b.point.x) * MID;
      labelY = (a.point.y + b.point.y) * MID;
    }
  }

  return { d, labelX, labelY, anchors, polyline };
};

/**
 * US-027: apply a drag delta to two polyline indices, constrained to the
 * anchor's perpendicular axis, then strip the first (source) and last
 * (target) points out so the result is suitable for persistence as a
 * connector's `waypoints` array.
 *
 * Endpoint behaviour: when an anchor's segment endpoint coincides with the
 * polyline's source (idx 0) or target (last idx), we INSERT a new corner at
 * the endpoint's current position before applying the delta. The original
 * endpoint stays glued to the node (it's derived from node geometry) and
 * the new corner takes over the dragged role — that's what produces an
 * orthogonal step when the user drags an endpoint-adjacent segment.
 *
 * The same index appearing twice (e.g. a curve anchor with a === b at the
 * midpoint) is deduped so the delta isn't applied twice.
 */
export const applyDragToPolyline = (
  polyline: XY[],
  anchor: SegmentAnchor,
  dx: number,
  dy: number,
): XY[] => {
  if (polyline.length < 2) return [];
  const next = polyline.map((p) => ({ ...p }));
  // Insert anchor copies for endpoint-adjacent segments. Walk from the end
  // first so the lower index doesn't shift when we splice near the start.
  const aIdx = anchor.polyline.a;
  const bIdx = anchor.polyline.b;
  let effectiveA = aIdx;
  let effectiveB = bIdx;
  const maxIdx = next.length - 1;
  if (bIdx === maxIdx) {
    const targetPoint = next[maxIdx];
    if (targetPoint) next.splice(maxIdx, 0, { ...targetPoint });
    // Indices unchanged at b; effectiveB now points at the inserted corner
    // (the original target moved one slot to the right).
    effectiveB = maxIdx;
  }
  if (aIdx === 0) {
    const sourcePoint = next[0];
    if (sourcePoint) next.splice(1, 0, { ...sourcePoint });
    // Source stays at 0; the inserted corner sits at index 1. effectiveB
    // also shifts because the array grew before the b position (unless b
    // was already adjusted above).
    effectiveA = 1;
    if (bIdx !== maxIdx) effectiveB = bIdx + 1;
    else effectiveB = effectiveB + 1;
  }
  const applied = new Set<number>();
  const applyAxisDelta = (idx: number): void => {
    if (idx <= 0 || idx >= next.length - 1) return;
    if (applied.has(idx)) return;
    applied.add(idx);
    const current = next[idx];
    if (!current) return;
    if (anchor.axis === 'vertical') {
      next[idx] = { x: current.x, y: current.y + dy };
    } else if (anchor.axis === 'horizontal') {
      next[idx] = { x: current.x + dx, y: current.y };
    } else {
      next[idx] = { x: current.x + dx, y: current.y + dy };
    }
  };
  applyAxisDelta(effectiveA);
  applyAxisDelta(effectiveB);
  // The waypoints persisted on the connector are the inner points of the
  // polyline — source/target are derived from node geometry at render time.
  return next.slice(1, -1);
};
