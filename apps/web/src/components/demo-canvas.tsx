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
  /**
   * Optimistic per-node position overrides. When present, they override the
   * positions in `nodes`. Used by the parent to keep a node visually pinned
   * to where the user dropped it while the PATCH round-trips.
   */
  positionOverrides?: Record<string, { x: number; y: number }>;
  /** Fired once per drag-stop with the node's final position. */
  onNodePositionChange?: (nodeId: string, position: { x: number; y: number }) => void;
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
  positionOverrides,
  onNodePositionChange,
}: DemoCanvasProps) {
  const rfNodes = useMemo<Node[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: positionOverrides?.[n.id] ?? n.position,
        data: {
          ...n.data,
          status: statusFor(runs, n.id),
          onPlay: onPlayNode,
        },
        selected: n.id === selectedNodeId,
      })),
    [nodes, selectedNodeId, runs, onPlayNode, positionOverrides],
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
        nodesDraggable={!!onNodePositionChange}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_e, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        onNodeDragStop={(_e, node) => {
          // Drag-while-moving lives in React Flow's internal state. We only
          // surface (and persist) the final position on drag-stop so we don't
          // PATCH the file on every pixel.
          onNodePositionChange?.(node.id, { x: node.position.x, y: node.position.y });
        }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
