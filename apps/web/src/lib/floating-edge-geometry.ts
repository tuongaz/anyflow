/**
 * Floating-edge geometry — given a source rectangle and the center of the
 * other endpoint's node, compute where a straight ray from the source center
 * to the other center crosses the source rectangle's perimeter, and which
 * side of the rectangle that crossing lies on.
 *
 * Used by `editable-edge.tsx` (US-025) to render an edge endpoint that
 * floats against the line-through-centers — the endpoint slides along the
 * node's perimeter in real time as either node moves, eliminating the
 * wrap-around artifacts the old facing-handle picker produced.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface FloatingRect {
  /** Top-left x of the node's bounding box. */
  x: number;
  /** Top-left y of the node's bounding box. */
  y: number;
  /** Width of the node's bounding box. */
  w: number;
  /** Height of the node's bounding box. */
  h: number;
}

export interface XY {
  x: number;
  y: number;
}

/** A coordinate + side, ready to feed React Flow's path helpers. */
export interface Endpoint {
  x: number;
  y: number;
  side: Side;
}

/**
 * Compute the perimeter intersection of the line from `rect`'s center toward
 * `otherCenter`, plus the side of the rectangle that contains the
 * intersection.
 *
 * Math: scale (dx, dy) by `min(halfW/|dx|, halfH/|dy|)` and add to the source
 * center. Side is decided by `|dx|*halfH` vs `|dy|*halfW`: when the
 * horizontal magnitude dominates the rectangle's aspect, the ray exits
 * left/right; otherwise top/bottom. A 45° tie (the two products equal) goes
 * to the x-axis so the result is deterministic and the side flips with the
 * sign of dx.
 *
 * Degenerate cases:
 * - same center (dx === 0 && dy === 0) → returns the rect's center with
 *   `side: 'right'` so callers never see NaN/Infinity.
 * - dx === 0 (purely vertical) → halfW/|dx| is Infinity, so the min picks
 *   halfH/|dy|; the intersection lies on top or bottom.
 * - dy === 0 (purely horizontal) → mirror of the above.
 */
export const getNodeIntersection = (rect: FloatingRect, otherCenter: XY): Endpoint => {
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  const cx = rect.x + halfW;
  const cy = rect.y + halfH;
  const dx = otherCenter.x - cx;
  const dy = otherCenter.y - cy;

  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy, side: 'right' };
  }

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const tx = absDx === 0 ? Number.POSITIVE_INFINITY : halfW / absDx;
  const ty = absDy === 0 ? Number.POSITIVE_INFINITY : halfH / absDy;
  const t = Math.min(tx, ty);

  const x = cx + dx * t;
  const y = cy + dy * t;

  // Side: compare horizontal vs vertical contribution, scaled by the
  // rectangle's aspect. >= sends 45° ties to the x-axis.
  const side: Side =
    absDx * halfH >= absDy * halfW ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';

  return { x, y, side };
};

/**
 * Per-endpoint resolution input: the node's bounding box plus the
 * `autoPicked` flag for that side. `null` means the live node geometry
 * isn't available yet (e.g. the node hasn't been measured) — the caller
 * should hand back the React-Flow-supplied fallback in that case.
 */
export interface EndpointInput {
  box: FloatingRect;
  autoPicked: boolean | undefined;
  /** React-Flow-supplied coords/side, used when the endpoint is pinned. */
  fallback: Endpoint;
}

/**
 * Resolve a single edge endpoint per the US-025 floating-vs-pinned rule:
 *
 * - When `autoPicked !== false` (floating; the default for new connectors):
 *   compute the perimeter intersection of the line through the two node
 *   centers via `getNodeIntersection`. Endpoint slides along the node's
 *   perimeter as either node moves.
 * - When `autoPicked === false` (user-pinned by an explicit handle drop):
 *   return the React-Flow-supplied fallback unchanged so a pinned handle
 *   stays put even if it points the "wrong" way after the other node moves.
 *
 * Pure function — extracted from `editable-edge.tsx` so the branch can be
 * unit-tested without mounting the component.
 */
export const resolveEdgeEndpoints = (
  source: EndpointInput | null,
  target: EndpointInput | null,
): { source: Endpoint; target: Endpoint } => {
  const sourceFallback = source?.fallback ?? { x: 0, y: 0, side: 'right' as Side };
  const targetFallback = target?.fallback ?? { x: 0, y: 0, side: 'left' as Side };
  if (!source || !target) {
    return { source: sourceFallback, target: targetFallback };
  }
  const sCenter = { x: source.box.x + source.box.w / 2, y: source.box.y + source.box.h / 2 };
  const tCenter = { x: target.box.x + target.box.w / 2, y: target.box.y + target.box.h / 2 };
  const resolvedSource =
    source.autoPicked === false ? source.fallback : getNodeIntersection(source.box, tCenter);
  const resolvedTarget =
    target.autoPicked === false ? target.fallback : getNodeIntersection(target.box, sCenter);
  return { source: resolvedSource, target: resolvedTarget };
};
