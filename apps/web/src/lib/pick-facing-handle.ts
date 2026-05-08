import type { DemoNode } from '@/lib/api';

export type Side = 't' | 'r' | 'b' | 'l';
export type HandleRole = 'source' | 'target';
export type NodeKind = DemoNode['type'];

/** Side a node center "faces" toward another center based on the centroid delta. */
export type Point = { x: number; y: number };

// Sides allowed for each role on each node kind. Today every kind uses the
// same layout — top + left are target-only, right + bottom are source-only —
// so the table is uniform; keep the kind axis so future kinds can specialize
// without touching every caller.
const ALLOWED: Record<NodeKind, Record<HandleRole, ReadonlyArray<Side>>> = {
  playNode: { source: ['r', 'b'], target: ['t', 'l'] },
  stateNode: { source: ['r', 'b'], target: ['t', 'l'] },
  shapeNode: { source: ['r', 'b'], target: ['t', 'l'] },
};

const SIDE_VEC: Record<Side, [number, number]> = {
  t: [0, -1],
  r: [1, 0],
  b: [0, 1],
  l: [-1, 0],
};

/**
 * Ideal facing side for an arbitrary direction. Resolves the major axis from
 * |dx| vs |dy|; on a 45° tie (|dx| === |dy|) the x-axis wins so the result
 * is determined by the sign of dx.
 */
const idealSide = (dx: number, dy: number): Side => {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= ay) return dx >= 0 ? 'r' : 'l';
  return dy >= 0 ? 'b' : 't';
};

/**
 * Pick the side of `from` that best faces `to`, restricted to handles of the
 * requested role on the node's kind. When the geometric ideal isn't allowed
 * for the role (e.g. ideal 'l' for a 'source' role on shape/play/state nodes
 * — they only expose source handles on right + bottom), the picker falls
 * back to whichever allowed side has the highest dot-product with the
 * direction vector — i.e. the one most pointing toward `to` among the
 * allowed options.
 */
export const pickFacingHandle = (
  from: Point,
  to: Point,
  role: HandleRole,
  fromKind: NodeKind,
): Side => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const allowed = ALLOWED[fromKind][role];
  const ideal = idealSide(dx, dy);
  if (allowed.includes(ideal)) return ideal;
  // Geometric fallback: among allowed sides, pick the one whose outward
  // normal best aligns with the direction vector to `to`. Largest dot
  // product wins; ties resolve to the first allowed side.
  let best: Side = allowed[0] ?? ideal;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const side of allowed) {
    const [vx, vy] = SIDE_VEC[side];
    const score = vx * dx + vy * dy;
    if (score > bestScore) {
      bestScore = score;
      best = side;
    }
  }
  return best;
};

// Approximate node centers for direction math. Width/height fall back to
// reasonable defaults per kind so the picker doesn't get fooled by a node
// with no explicit dimensions yet (e.g. a freshly created play-node with
// content-driven height).
const DEFAULT_W: Record<NodeKind, number> = {
  playNode: 200,
  stateNode: 200,
  shapeNode: 100,
};
const DEFAULT_H: Record<NodeKind, number> = {
  playNode: 80,
  stateNode: 80,
  shapeNode: 60,
};

export const nodeCenter = (n: DemoNode): Point => {
  const w = n.data.width ?? DEFAULT_W[n.type];
  const h = n.data.height ?? DEFAULT_H[n.type];
  return { x: n.position.x + w / 2, y: n.position.y + h / 2 };
};
