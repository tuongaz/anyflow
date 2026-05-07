import { PlayNode } from '@/components/nodes/play-node';
import { ShapeNode } from '@/components/nodes/shape-node';
import { StateNode } from '@/components/nodes/state-node';
import type { NodeStatus } from '@/components/nodes/status-pill';
import type { NodeRuns } from '@/hooks/use-node-runs';
import type { OverrideMap } from '@/hooks/use-pending-overrides';
import type { Connector, DemoNode } from '@/lib/api';
import { connectorToEdge } from '@/lib/connector-to-edge';
import {
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeChange,
  ReactFlow,
  applyNodeChanges,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
   * Optimistic per-node overrides. When present, they shallow-merge over the
   * server `nodes` (with `data` shallow-merged one level deeper). Used by the
   * parent to keep an edit visually pinned while the PATCH round-trips.
   */
  nodeOverrides?: OverrideMap<DemoNode>;
  /** Fired once per drag-stop with the node's final position. */
  onNodePositionChange?: (nodeId: string, position: { x: number; y: number }) => void;
  /**
   * Fired once per resize-stop with the node's final dimensions. Wiring this
   * enables NodeResizer's resize handles inside each custom node.
   */
  onNodeResize?: (nodeId: string, dims: { width: number; height: number }) => void;
}

const mergeNodeOverride = (node: DemoNode, override: Partial<DemoNode> | undefined): DemoNode => {
  if (!override) return node;
  // The override is keyed by the node's id, so its `data` (when present) is
  // always a partial of the SAME variant as node.data. TS can't see this
  // through the discriminated union spread, so cast at the boundary.
  const data = override.data ? { ...node.data, ...override.data } : node.data;
  return { ...node, ...override, data } as DemoNode;
};

const nodeTypes = { playNode: PlayNode, stateNode: StateNode, shapeNode: ShapeNode };

const statusFor = (runs: NodeRuns | undefined, id: string): NodeStatus =>
  runs?.[id]?.status ?? 'idle';

export function DemoCanvas({
  nodes,
  connectors,
  selectedNodeId,
  onSelectNode,
  runs,
  onPlayNode,
  nodeOverrides,
  onNodePositionChange,
  onNodeResize,
}: DemoCanvasProps) {
  // Block upstream sync while a node is mid-drag or mid-resize. NodeResizer
  // dispatches dimension changes into rfNodes during the gesture; if we then
  // overwrite rfNodes with sourceNodes (from server, which still has the old
  // dimensions until the PATCH echoes back), the node snaps back. The
  // resizingRef is set/cleared by node components via data.setResizing.
  const draggingRef = useRef(false);
  const resizingRef = useRef(false);
  const setResizing = useCallback((on: boolean) => {
    resizingRef.current = on;
  }, []);

  const sourceNodes = useMemo<Node[]>(
    () =>
      nodes.map((n) => {
        const merged = mergeNodeOverride(n, nodeOverrides?.[n.id]);
        const node: Node = {
          id: merged.id,
          type: merged.type,
          position: merged.position,
          data: {
            ...merged.data,
            status: statusFor(runs, n.id),
            onPlay: onPlayNode,
            onResize: onNodeResize,
            setResizing,
          },
          selected: n.id === selectedNodeId,
        };
        // Pass explicit width/height to the React Flow node wrapper when set
        // in data. NodeResizer dispatches dimension changes that update these
        // during a gesture; we only persist (and hence sync them back into
        // data) on resize-stop.
        if (merged.data.width !== undefined) node.width = merged.data.width;
        if (merged.data.height !== undefined) node.height = merged.data.height;
        return node;
      }),
    [nodes, selectedNodeId, runs, onPlayNode, onNodeResize, setResizing, nodeOverrides],
  );

  // React Flow needs internal node state + onNodesChange to render drag
  // motion smoothly. Without it, the controlled `nodes` prop overrides the
  // drag position on every parent re-render (SSE `runs` ticks etc.) and the
  // node snaps back mid-drag. We freeze upstream sync while a drag is in
  // flight; the parent's positionOverrides take over after drag-stop.
  const [rfNodes, setRfNodes] = useState<Node[]>(sourceNodes);

  useEffect(() => {
    if (draggingRef.current || resizingRef.current) return;
    setRfNodes(sourceNodes);
  }, [sourceNodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

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
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        fitView
        nodesDraggable={!!onNodePositionChange}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_e, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        onNodeDragStart={() => {
          draggingRef.current = true;
        }}
        onNodeDragStop={(_e, node) => {
          // Drag-while-moving lives in React Flow's internal state. We only
          // surface (and persist) the final position on drag-stop so we don't
          // PATCH the file on every pixel.
          draggingRef.current = false;
          onNodePositionChange?.(node.id, { x: node.position.x, y: node.position.y });
        }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
