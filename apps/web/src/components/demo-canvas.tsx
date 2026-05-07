import { PlayNode } from '@/components/nodes/play-node';
import { StateNode } from '@/components/nodes/state-node';
import type { DemoEdge, DemoNode } from '@/lib/api';
import { Background, Controls, type Edge, type Node, ReactFlow } from '@xyflow/react';
import { useMemo } from 'react';

import '@xyflow/react/dist/style.css';

export interface DemoCanvasProps {
  nodes: DemoNode[];
  edges: DemoEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

const nodeTypes = { playNode: PlayNode, stateNode: StateNode };

export function DemoCanvas({ nodes, edges, selectedNodeId, onSelectNode }: DemoCanvasProps) {
  const rfNodes = useMemo<Node[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        // Each render passes a fresh status:'idle' for now; M1.D will mix in
        // the real per-node status reducer driven by SSE events.
        data: { ...n.data, status: 'idle' as const },
        selected: n.id === selectedNodeId,
      })),
    [nodes, selectedNodeId],
  );

  const rfEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        animated: e.animated,
      })),
    [edges],
  );

  return (
    <div data-testid="anydemo-canvas" className="h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_e, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
