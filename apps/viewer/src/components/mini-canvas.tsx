import { ReactFlow, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import { convertConnector, convertNode } from '../lib/demo-to-flow';
import type { Demo } from '../types';
import { ViewHtmlNode } from './nodes/view-html-node';
import { ViewIconNode } from './nodes/view-icon-node';
import { ViewImageNode } from './nodes/view-image-node';
import { ViewPlayNode } from './nodes/view-play-node';
import { ViewShapeNode } from './nodes/view-shape-node';
import { ViewStateNode } from './nodes/view-state-node';
import { ViewEdge } from './view-edge';

const nodeTypes = {
  playNode: ViewPlayNode,
  stateNode: ViewStateNode,
  shapeNode: ViewShapeNode,
  imageNode: ViewImageNode,
  iconNode: ViewIconNode,
  htmlNode: ViewHtmlNode,
};

const edgeTypes = { viewEdge: ViewEdge };

const DEFAULT_EDGE_OPTIONS = { zIndex: 0 };

export interface MiniCanvasProps {
  demo: Demo;
}

export function MiniCanvas({ demo }: MiniCanvasProps) {
  const initialNodes = useMemo(() => demo.nodes.map(convertNode), [demo.nodes]);
  const initialEdges = useMemo(() => demo.connectors.map(convertConnector), [demo.connectors]);
  const [nodes] = useNodesState(initialNodes);
  const [edges] = useEdgesState(initialEdges);

  return (
    <div
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        proOptions={{ hideAttribution: true }}
        style={{ background: '#f8fafc' }}
      />
    </div>
  );
}
