import { describe, expect, it } from 'bun:test';
import { type PasteableConnector, type PasteableNode, buildPastePayload } from '@/lib/clipboard';

type TestNode = PasteableNode & { tag?: string };
type TestConn = PasteableConnector & { tag?: string };

const node = (id: string, x: number, y: number): TestNode => ({ id, position: { x, y } });

const conn = (id: string, source: string, target: string): TestConn => ({
  id,
  source,
  target,
});

const seqGen = (prefix: string) => {
  let i = 0;
  return () => `${prefix}-${++i}`;
};

describe('buildPastePayload', () => {
  it('rewrites a single node with +24,+24 offset when flowPos is null', () => {
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

  it('anchors top-leftmost node at flowPos when supplied', () => {
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

  it('preserves relative position between multiple nodes', () => {
    const { newNodes } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('a', 0, 0), node('b', 100, 0), node('c', 50, 100)],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes[0]?.position).toEqual({ x: 24, y: 24 });
    expect(newNodes[1]?.position).toEqual({ x: 124, y: 24 });
    expect(newNodes[2]?.position).toEqual({ x: 74, y: 124 });
  });

  it('rewires connector endpoints when both nodes are in the copied set', () => {
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
