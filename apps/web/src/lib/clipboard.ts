export interface PasteableNode {
  id: string;
  position: { x: number; y: number };
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
   * Anchor position in flow space. When set, the topmost-leftmost node lands at
   * this position; every other node maintains its relative offset. When null
   * (keyboard Cmd/Ctrl+V), every node is shifted by `defaultOffset` (default
   * +24,+24) from its original position.
   */
  flowPos: { x: number; y: number } | null;
  /** Generator for fresh node ids — injected so tests get deterministic ids. */
  nodeIdGen: (oldId: string) => string;
  /** Generator for fresh connector ids — same rationale as `nodeIdGen`. */
  connectorIdGen: (oldId: string) => string;
  /** Translation applied to nodes when `flowPos` is null. */
  defaultOffset?: { x: number; y: number };
}

export interface BuildPastePayloadResult<N extends PasteableNode, C extends PasteableConnector> {
  /** New nodes with rewritten ids and positions. */
  newNodes: N[];
  /** New connectors with rewritten ids + endpoints. */
  newConnectors: C[];
  /** Old-id → new-id mapping for both nodes and connectors. */
  idMap: ReadonlyMap<string, string>;
}

/**
 * Rewrite a copied clipboard payload into a fresh paste:
 *  - Every node gets a new id via `nodeIdGen(oldId)` and is translated by the
 *    paste offset (anchor to `flowPos` or +defaultOffset from original position).
 *  - Connectors whose source or target is in the copied set are rewired to the
 *    new ids; endpoints outside the set are left alone.
 */
export function buildPastePayload<N extends PasteableNode, C extends PasteableConnector>({
  nodes,
  connectors,
  flowPos,
  nodeIdGen,
  connectorIdGen,
  defaultOffset = { x: 24, y: 24 },
}: BuildPastePayloadInput<N, C>): BuildPastePayloadResult<N, C> {
  const idMap = new Map<string, string>();
  for (const n of nodes) {
    idMap.set(n.id, nodeIdGen(n.id));
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
  }
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;
  const offsetX = flowPos ? flowPos.x - minX : defaultOffset.x;
  const offsetY = flowPos ? flowPos.y - minY : defaultOffset.y;

  const newNodes: N[] = nodes.map((n) => {
    const newId = idMap.get(n.id);
    if (newId === undefined) throw new Error(`paste id missing for ${n.id}`);
    return {
      ...n,
      id: newId,
      position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
    };
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
