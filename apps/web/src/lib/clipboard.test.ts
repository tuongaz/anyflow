import { describe, expect, it } from 'bun:test';
import { type PasteableConnector, type PasteableNode, buildPastePayload } from '@/lib/clipboard';

// Test fixtures use minimal node/connector shapes (extra fields like `data`
// flow through via the generic spread). The helper is generic over T extends
// PasteableNode so callers preserve their concrete type.
type TestNode = PasteableNode & { tag?: string };
type TestConn = PasteableConnector & { tag?: string };

const node = (id: string, x: number, y: number, parentId?: string): TestNode =>
  parentId !== undefined ? { id, position: { x, y }, parentId } : { id, position: { x, y } };

const conn = (id: string, source: string, target: string): TestConn => ({
  id,
  source,
  target,
});

// Deterministic id generators so tests can assert exact output without
// pulling in `crypto.randomUUID()`. Counter resets per call site.
const seqGen = (prefix: string) => {
  let i = 0;
  return () => `${prefix}-${++i}`;
};

describe('buildPastePayload', () => {
  it('rewrites a single top-level node with +24,+24 offset when flowPos is null', () => {
    const { newNodes, idMap } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('a', 100, 200)],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes).toEqual([{ id: 'n-1', position: { x: 124, y: 224 } }]);
    expect(idMap.get('a')).toBe('n-1');
  });

  it('anchors top-leftmost top-level node at flowPos when supplied', () => {
    // Originals at (50,50) and (150,100). flowPos at (10,20) → minX=50,minY=50
    // → offsetX = 10-50 = -40, offsetY = 20-50 = -30. First node lands at
    // (10,20); the second offset by the same translation.
    const { newNodes } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('a', 50, 50), node('b', 150, 100)],
      connectors: [],
      flowPos: { x: 10, y: 20 },
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes[0]?.position).toEqual({ x: 10, y: 20 });
    expect(newNodes[1]?.position).toEqual({ x: 110, y: 70 });
  });

  it('preserves relative position between multiple top-level nodes', () => {
    const { newNodes } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('a', 0, 0), node('b', 100, 0), node('c', 50, 100)],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    // Every top-level node shifts by +24,+24 — relative positions preserved.
    expect(newNodes[0]?.position).toEqual({ x: 24, y: 24 });
    expect(newNodes[1]?.position).toEqual({ x: 124, y: 24 });
    expect(newNodes[2]?.position).toEqual({ x: 74, y: 124 });
  });

  it('rewires parentId when both parent and child are in the copied set', () => {
    // The parent is the group "g"; child "c" has parentId "g". After paste,
    // child's parentId must point to the NEW group id (not the original "g").
    const { newNodes, idMap } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('g', 0, 0), node('c', 20, 30, 'g')],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    const newGroup = newNodes.find((n) => idMap.get('g') === n.id);
    const newChild = newNodes.find((n) => idMap.get('c') === n.id);
    expect(newGroup?.id).toBe('n-1');
    expect(newChild?.id).toBe('n-2');
    expect(newChild?.parentId).toBe('n-1'); // rewired to new group
  });

  it('preserves child parent-relative position (NOT double-translated by paste offset)', () => {
    // The bug US-022 fixed: previously a child whose parent was also copied
    // got the absolute paste offset (+24,+24) applied to its parent-relative
    // position, landing it +offset INSIDE the new group instead of at the
    // same relative spot. The fix: keep child positions unchanged when their
    // parent is in the copy set.
    const { newNodes, idMap } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('g', 100, 100), node('c', 20, 30, 'g')],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    const newGroup = newNodes.find((n) => n.id === idMap.get('g'));
    const newChild = newNodes.find((n) => n.id === idMap.get('c'));
    // Parent moved by +24,+24 → (124,124). Child still at (20,30)
    // parent-relative, so its world-space position is (144,154).
    expect(newGroup?.position).toEqual({ x: 124, y: 124 });
    expect(newChild?.position).toEqual({ x: 20, y: 30 });
  });

  it('drops parentId on a top-level node whose original parent is NOT in the copy set', () => {
    // Copying only the child "c" (not its parent "g") — the new node would
    // otherwise hang under the still-living original "g", which surprises the
    // user. The helper drops parentId so the paste lands as a top-level node.
    const { newNodes } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('c', 20, 30, 'g')],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes[0]?.parentId).toBeUndefined();
    // Position gets translated by +24,+24 like any top-level node.
    expect(newNodes[0]?.position).toEqual({ x: 44, y: 54 });
  });

  it('uses ONLY top-level nodes for anchor calculation', () => {
    // Children have parent-relative positions that aren't comparable to
    // flow-space coordinates. The anchor should ignore them entirely.
    //
    // Top-level: g at (200,200). Child c at parent-relative (10,10) — would be
    // the "min" if we naively used it, but we shouldn't. With flowPos=(50,50),
    // offsetX = 50-200 = -150 → new g.position = (50,50).
    const { newNodes, idMap } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('g', 200, 200), node('c', 10, 10, 'g')],
      connectors: [],
      flowPos: { x: 50, y: 50 },
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    const newGroup = newNodes.find((n) => n.id === idMap.get('g'));
    expect(newGroup?.position).toEqual({ x: 50, y: 50 });
  });

  it('rewires connector endpoints when both nodes are in the copied set', () => {
    // (b) Cmd+C with 3 nodes + 2 edges between them + Cmd+V → 3 new nodes +
    // 2 new edges with rewired ids.
    const { newNodes, newConnectors, idMap } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('a', 0, 0), node('b', 100, 0), node('c', 200, 0)],
      connectors: [conn('e1', 'a', 'b'), conn('e2', 'b', 'c')],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes.length).toBe(3);
    expect(newConnectors.length).toBe(2);
    expect(newConnectors[0]?.source).toBe(idMap.get('a'));
    expect(newConnectors[0]?.target).toBe(idMap.get('b'));
    expect(newConnectors[1]?.source).toBe(idMap.get('b'));
    expect(newConnectors[1]?.target).toBe(idMap.get('c'));
    // Connector ids must be fresh, not reused from originals.
    expect(newConnectors[0]?.id).toBe('c-1');
    expect(newConnectors[1]?.id).toBe('c-2');
  });

  it('preserves extra fields on nodes and connectors via generic spread', () => {
    const { newNodes, newConnectors } = buildPastePayload<TestNode, TestConn>({
      nodes: [{ id: 'a', position: { x: 0, y: 0 }, tag: 'preserved' }],
      connectors: [{ id: 'e', source: 'a', target: 'a', tag: 'edge-tag' }],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes[0]?.tag).toBe('preserved');
    expect(newConnectors[0]?.tag).toBe('edge-tag');
  });

  it('returns empty arrays when input is empty', () => {
    const { newNodes, newConnectors, idMap } = buildPastePayload<TestNode, TestConn>({
      nodes: [],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes).toEqual([]);
    expect(newConnectors).toEqual([]);
    expect(idMap.size).toBe(0);
  });

  it('falls back to 0,0 anchor when every copied node is a child (no top-level candidate)', () => {
    // Defensive edge case — buildPastePayload shouldn't crash if a caller
    // somehow hands over only child nodes (parent NOT in the set). Each child
    // gets parentId dropped (top-level fallback path), translated by +24,+24
    // from its original position.
    const { newNodes } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('c1', 5, 5, 'g'), node('c2', 15, 15, 'g')],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes[0]?.position).toEqual({ x: 29, y: 29 });
    expect(newNodes[1]?.position).toEqual({ x: 39, y: 39 });
    expect(newNodes[0]?.parentId).toBeUndefined();
    expect(newNodes[1]?.parentId).toBeUndefined();
  });

  it('uses custom defaultOffset when provided', () => {
    const { newNodes } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('a', 0, 0)],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
      defaultOffset: { x: 50, y: 75 },
    });
    expect(newNodes[0]?.position).toEqual({ x: 50, y: 75 });
  });
});
