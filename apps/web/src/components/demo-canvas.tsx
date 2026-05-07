import { PlayNode } from '@/components/nodes/play-node';
import { StateNode } from '@/components/nodes/state-node';
import type { NodeStatus } from '@/components/nodes/status-pill';
import type { NodeRuns } from '@/hooks/use-node-runs';
import type { Connector, DemoNode } from '@/lib/api';
import { connectorToEdge } from '@/lib/connector-to-edge';
import { Background, Controls, type Edge, type Node, ReactFlow } from '@xyflow/react';
import { useMemo } from 'react';

import '@xyflow/react/dist/style.css';

export interface DemoCanvasProps {
  nodes: DemoNode[];
  connectors: Connector[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  /** Per-node run state from SSE events. */
  runs?: NodeRuns;
  /** Click handler for a PlayNode's Play button. */
  onPlayNode?: (nodeId: string) => void;
}

const nodeTypes = { playNode: PlayNode, stateNode: StateNode };

const statusFor = (runs: NodeRuns | undefined, id: string): NodeStatus =>
  runs?.[id]?.status ?? 'idle';

export function DemoCanvas({
  nodes,
  connectors,
  selectedNodeId,
  onSelectNode,
  runs,
  onPlayNode,
}: DemoCanvasProps) {
  const rfNodes = useMemo<Node[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          ...n.data,
          status: statusFor(runs, n.id),
          onPlay: onPlayNode,
        },
        selected: n.id === selectedNodeId,
      })),
    [nodes, selectedNodeId, runs, onPlayNode],
  );

  const rfEdges = useMemo<Edge[]>(
    () =>
      connectors.map((c) => {
        const adjacentRunning =
          statusFor(runs, c.source) === 'running' || statusFor(runs, c.target) === 'running';
        return connectorToEdge(c, adjacentRunning);
      }),
    [connectors, runs],
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
