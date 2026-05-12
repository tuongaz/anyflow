/**
 * US-012/US-013: pure helpers for the group create/ungroup operations on the
 * canvas. Kept outside demo-view.tsx so the geometry + filtering invariants
 * can be unit-tested without mounting React Flow.
 *
 * The functions here operate on a minimal Node shape (`GroupableNode`) so the
 * tests do not need to construct full DemoNode unions and the production
 * caller can adapt its own shape into the call site with one helper. Width /
 * height fall back to 0 when omitted — for the bbox math that's a safe
 * default because an unknown-dim node still anchors at its `position`.
 */

export interface Position {
  x: number;
  y: number;
}

export interface GroupableNode {
  id: string;
  position: Position;
  /** Top-level parentId mirrors DemoNode (US-011). */
  parentId?: string;
  /** Discriminator — `'group'` is what `selectUngroupableSet` looks for. */
  type: string;
  /** Rendered width on the canvas (falls back to 0 for the bbox math). */
  width?: number;
  /** Rendered height on the canvas. */
  height?: number;
}

export interface GroupBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Tight bounding box (in absolute canvas-space coords) over the supplied
 * children, optionally inset by `padding` on every side. Returns a zero-size
 * bbox at (0, 0) when the input is empty so callers don't have to special-case
 * the degenerate path.
 */
export function computeGroupBbox(children: readonly GroupableNode[], padding: number): GroupBbox {
  if (children.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const child of children) {
    const w = child.width ?? 0;
    const h = child.height ?? 0;
    if (child.position.x < minX) minX = child.position.x;
    if (child.position.y < minY) minY = child.position.y;
    if (child.position.x + w > maxX) maxX = child.position.x + w;
    if (child.position.y + h > maxY) maxY = child.position.y + h;
  }
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + 2 * padding,
    height: maxY - minY + 2 * padding,
  };
}

/**
 * Convert a child's absolute canvas position into its position relative to
 * the supplied parent's top-left. React Flow's per-child `position` field is
 * always relative to the parent (when `parentId` is set) so this is what we
 * persist when wrapping free nodes into a new group.
 */
export function toRelativePosition(child: Position, parent: Position): Position {
  return { x: child.x - parent.x, y: child.y - parent.y };
}

/**
 * Inverse of `toRelativePosition` — recover the child's absolute canvas
 * position from its parent-relative position. Used when ungrouping (US-013)
 * so the child stays put visually after `parentId` is cleared.
 */
export function toAbsolutePosition(child: Position, parent: Position): Position {
  return { x: child.x + parent.x, y: child.y + parent.y };
}

/**
 * Filter a selection of ids down to the nodes that are eligible to be wrapped
 * in a NEW group: must exist, must NOT already have a `parentId` (single-level
 * groups per design — no nested groups), and must NOT be a group themselves
 * (groups don't get grouped into other groups in v1). Order of the input
 * `selectedIds` is preserved in the output so the caller's subsequent batch
 * has a stable ordering.
 */
export function selectGroupableSet(
  selectedIds: readonly string[],
  nodes: readonly GroupableNode[],
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const out: string[] = [];
  for (const id of selectedIds) {
    const node = byId.get(id);
    if (!node) continue;
    if (node.parentId !== undefined) continue;
    if (node.type === 'group') continue;
    out.push(id);
  }
  return out;
}

/**
 * Filter a selection of ids down to the group nodes in it (the candidates for
 * the right-click Ungroup item in US-013). Order of the input `selectedIds`
 * is preserved.
 */
export function selectUngroupableSet(
  selectedIds: readonly string[],
  nodes: readonly GroupableNode[],
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const out: string[] = [];
  for (const id of selectedIds) {
    const node = byId.get(id);
    if (!node) continue;
    if (node.type === 'group') out.push(id);
  }
  return out;
}

/**
 * US-014: expand a list of to-delete node ids so that every group id in the
 * input pulls in the ids of every node whose `parentId` matches it. Returns
 * a deduplicated array preserving the input's relative order; non-group ids
 * are kept as-is. Flat groups only — one level of `parentId` expansion is
 * enough because the schema's `superRefine` already rejects nested groups.
 *
 * The expansion is the contract that lets `onDeleteSelection` / `onDeleteNode`
 * delete a group AND its children in a single batch (one undo entry covers
 * the whole cascade, and the schema invariant "child.parentId references a
 * resolvable parent" stays satisfied — the children leave with their parent).
 */
export function expandGroupNodeIds(
  nodeIds: readonly string[],
  nodes: readonly GroupableNode[],
): string[] {
  if (nodeIds.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const groupIdSet = new Set<string>();
  for (const id of nodeIds) {
    const node = byId.get(id);
    if (node && node.type === 'group') groupIdSet.add(id);
  }
  if (groupIdSet.size === 0) return [...nodeIds];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of nodeIds) push(id);
  for (const node of nodes) {
    if (node.parentId !== undefined && groupIdSet.has(node.parentId)) push(node.id);
  }
  return out;
}

/**
 * US-017: the Cmd/Ctrl+G shortcut toggles grouping based on the current
 * selection. This pure planner is the decision oracle — it does NOT mutate
 * anything; the caller dispatches the resulting `kind` through the existing
 * `onGroupNodes` / `onUngroupSelection` callbacks. Cases:
 *
 *  - `none`: empty selection, single loose node, mixed-parent selections, or
 *    a [child + loose] selection. The `reason` field is exposed for
 *    `console.debug` diagnostics in dev — silent in prod where `debug`
 *    severity is filtered out by default.
 *  - `ungroup`: selection is either a single group node OR one-or-more
 *    children that all share the same `parentId`. `groupIds` contains the
 *    parent group id(s) to dissolve (NEVER child ids — the consumer's
 *    `selectUngroupableSet` filter requires `type === 'group'`).
 *  - `group`: selection is 2+ nodes that aren't all children of the same
 *    group. The consumer (`groupNodes` in demo-view.tsx) re-filters via
 *    `selectGroupableSet` so groups + already-parented nodes are excluded
 *    from the new wrapper.
 */
export type GroupShortcutPlan =
  | { kind: 'none'; reason: 'empty' | 'single-loose' | 'mixed' }
  | { kind: 'group' }
  | { kind: 'ungroup'; groupIds: string[] };

export function planGroupShortcutAction(
  selectedIds: readonly string[],
  nodes: readonly GroupableNode[],
): GroupShortcutPlan {
  if (selectedIds.length === 0) return { kind: 'none', reason: 'empty' };

  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const selected: GroupableNode[] = [];
  for (const id of selectedIds) {
    const node = byId.get(id);
    if (node) selected.push(node);
  }
  if (selected.length === 0) return { kind: 'none', reason: 'empty' };

  const groupIdsInSelection = new Set<string>();
  for (const n of selected) {
    if (n.type === 'group') groupIdsInSelection.add(n.id);
  }
  const parentIdsInSelection = new Set<string>();
  for (const n of selected) {
    if (n.parentId !== undefined) parentIdsInSelection.add(n.parentId);
  }

  // (a) single group node selected → ungroup it.
  if (selected.length === 1 && groupIdsInSelection.size === 1) {
    return { kind: 'ungroup', groupIds: [...groupIdsInSelection] };
  }

  // (b) selection is one-or-more children that all share the same parentId
  //     and contains NO group nodes → ungroup that parent.
  if (
    groupIdsInSelection.size === 0 &&
    parentIdsInSelection.size === 1 &&
    selected.every((n) => n.parentId !== undefined)
  ) {
    return { kind: 'ungroup', groupIds: [...parentIdsInSelection] };
  }

  // No-op: single loose node (length 1 but not a group).
  if (selected.length === 1) return { kind: 'none', reason: 'single-loose' };

  // No-op: mixed parents — children from different groups, or some-children-
  // some-loose, or a group + a foreign child. All ambiguous semantics.
  if (parentIdsInSelection.size > 1) return { kind: 'none', reason: 'mixed' };
  if (parentIdsInSelection.size === 1 && !selected.every((n) => n.parentId !== undefined)) {
    return { kind: 'none', reason: 'mixed' };
  }

  // Otherwise (2+ nodes, all at the top level — loose shapes and/or group
  // nodes): defer to onGroupNodes, which filters via selectGroupableSet and
  // bails if fewer than 2 eligible nodes remain.
  return { kind: 'group' };
}

/**
 * React Flow invariant: a parent node must appear BEFORE all of its children
 * in the `nodes` array, otherwise the child renders without a parent context
 * for one frame and its position is mis-anchored. Use this to insert a freshly
 * created group ahead of its children in a single splice — the function
 * returns a new array (does not mutate the input) so callers can pass it
 * straight to a setter.
 */
export function insertGroupBeforeChildren<T extends { id: string }>(
  nodes: readonly T[],
  group: T,
  childIds: readonly string[],
): T[] {
  const childSet = new Set(childIds);
  // Find the earliest index occupied by any of the children. Insert the group
  // immediately before it. If no child is found (shouldn't happen in
  // production — caller filters first), append the group at the end.
  let earliest = nodes.length;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node && childSet.has(node.id) && i < earliest) earliest = i;
  }
  const out = nodes.slice();
  out.splice(earliest, 0, group);
  return out;
}
