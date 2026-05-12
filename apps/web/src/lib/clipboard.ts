/**
 * US-022: pure helpers for clipboard paste payload construction. Extracted
 * from `onPasteNodes` in demo-view.tsx so the parent-child rewiring + child-
 * position preservation invariants can be unit-tested without rendering the
 * page. The dispatcher in demo-view.tsx is a thin wrapper that calls
 * `buildPastePayload` and then fires the optimistic overrides + POSTs.
 *
 * Generic over the minimal node + connector shape so callers (DemoView,
 * tests) keep their concrete types via spread without an extra cast.
 */

export interface PasteableNode {
  id: string;
  position: { x: number; y: number };
  parentId?: string;
}

export interface PasteableConnector {
  id: string;
  source: string;
  target: string;
}

export interface BuildPastePayloadInput<N extends PasteableNode, C extends PasteableConnector> {
  nodes: readonly N[];
  connectors: readonly C[];
  /**
   * Anchor position in flow space. When set, the topmost-leftmost top-level
   * node lands at this position; every other top-level node maintains its
   * relative offset. When null (keyboard Cmd/Ctrl+V), every top-level node is
   * shifted by `defaultOffset` (default +24,+24) from its original position.
   */
  flowPos: { x: number; y: number } | null;
  /** Generator for fresh node ids — injected so tests get deterministic ids. */
  nodeIdGen: (oldId: string) => string;
  /** Generator for fresh connector ids — same rationale as `nodeIdGen`. */
  connectorIdGen: (oldId: string) => string;
  /** Translation applied to top-level nodes when `flowPos` is null. */
  defaultOffset?: { x: number; y: number };
}

export interface BuildPastePayloadResult<N extends PasteableNode, C extends PasteableConnector> {
  /** New nodes with rewritten ids, positions, and parentIds. */
  newNodes: N[];
  /** New connectors with rewritten ids + endpoints. */
  newConnectors: C[];
  /** Old-id → new-id mapping for both nodes and connectors. */
  idMap: ReadonlyMap<string, string>;
}

/**
 * Rewrite a copied clipboard payload into a fresh paste:
 *  - Every node gets a new id via `nodeIdGen(oldId)`.
 *  - Children whose `parentId` is ALSO in the copied set are rewired to the
 *    new parent's id, and their (parent-relative) position is preserved
 *    verbatim so they land at the same offset inside the new parent
 *    (NOT double-translated by the absolute paste offset).
 *  - Top-level nodes (no parent, or parent not in the copy set) receive the
 *    absolute paste offset. Their `parentId` is dropped if it pointed
 *    outside the copied set (the original parent isn't being duplicated, so
 *    keeping the reference would surprise the user).
 *  - Connectors whose source or target is in the copied set are rewired to
 *    the new ids; endpoints outside the set are left alone (the caller is
 *    expected to filter dangling connectors at the copy step — see
 *    `onCopyNodes` in demo-view.tsx).
 *
 * Returns the new payload + id map so the caller can wire optimistic
 * overrides and persistence in a single pass.
 */
export function buildPastePayload<N extends PasteableNode, C extends PasteableConnector>({
  nodes,
  connectors,
  flowPos,
  nodeIdGen,
  connectorIdGen,
  defaultOffset = { x: 24, y: 24 },
}: BuildPastePayloadInput<N, C>): BuildPastePayloadResult<N, C> {
  const copiedIdSet = new Set(nodes.map((n) => n.id));
  const idMap = new Map<string, string>();
  for (const n of nodes) {
    idMap.set(n.id, nodeIdGen(n.id));
  }

  const isCopiedChild = (n: N) => n.parentId !== undefined && copiedIdSet.has(n.parentId);

  // Anchor using ONLY top-level nodes — children have parent-relative
  // positions that aren't comparable to flow-space coordinates.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    if (isCopiedChild(n)) continue;
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
  }
  // Defensive fallback when every copied node is a child (no anchor
  // candidates) — the keyboard-paste offset still works against 0,0.
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;
  const offsetX = flowPos ? flowPos.x - minX : defaultOffset.x;
  const offsetY = flowPos ? flowPos.y - minY : defaultOffset.y;

  const newNodes: N[] = nodes.map((n) => {
    const newId = idMap.get(n.id);
    if (newId === undefined) throw new Error(`paste id missing for ${n.id}`);
    if (isCopiedChild(n)) {
      const newParentId = n.parentId !== undefined ? idMap.get(n.parentId) : undefined;
      return {
        ...n,
        id: newId,
        parentId: newParentId ?? n.parentId,
      };
    }
    // Top-level node: translate by the absolute paste offset. Drop a parentId
    // that points outside the copied set so the paste doesn't try to re-parent
    // under a node that wasn't copied (any parent IN the set would have gone
    // through the isCopiedChild branch above, so here parentId is either
    // undefined OR dangling — either way we leave it off the output).
    const { parentId: _drop, ...rest } = n;
    void _drop;
    return {
      ...rest,
      id: newId,
      position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
    } as N;
  });

  const newConnectors: C[] = connectors.map((c) => {
    const newId = connectorIdGen(c.id);
    return {
      ...c,
      id: newId,
      source: idMap.get(c.source) ?? c.source,
      target: idMap.get(c.target) ?? c.target,
    };
  });

  return { newNodes, newConnectors, idMap };
}
