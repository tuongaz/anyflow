import { type Edge, MarkerType, type Node, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import { colorTokenStyle } from '../lib/color-tokens';
import { UuidContext } from '../lib/uuid-context';
import type { Connector, Demo, DemoNode } from '../types';
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

const STYLE_BY_KIND: Record<Connector['kind'], { strokeDasharray?: string }> = {
  http: {},
  event: { strokeDasharray: '6 4' },
  queue: { strokeDasharray: '2 4' },
  default: {},
};

const STYLE_BY_STYLE: Record<'solid' | 'dashed' | 'dotted', { strokeDasharray?: string }> = {
  solid: {},
  dashed: { strokeDasharray: '6 4' },
  dotted: { strokeDasharray: '2 4' },
};

function convertNode(node: DemoNode): Node {
  const data = node.data as unknown as Record<string, unknown>;
  const w = typeof data.width === 'number' ? data.width : undefined;
  const h = typeof data.height === 'number' ? data.height : undefined;
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    data,
    ...(w !== undefined ? { width: w } : {}),
    ...(h !== undefined ? { height: h } : {}),
  };
}

function convertConnector(connector: Connector): Edge {
  const dashStyle = connector.style
    ? STYLE_BY_STYLE[connector.style]
    : STYLE_BY_KIND[connector.kind];
  const colorStyle = colorTokenStyle(connector.color, 'edge');
  const strokeWidth = connector.borderSize ?? 2;
  const style = { ...dashStyle, ...colorStyle, strokeWidth };

  const direction = connector.direction ?? 'forward';
  const markerColor = colorStyle.stroke;
  const arrow = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: markerColor };

  return {
    id: connector.id,
    source: connector.source,
    target: connector.target,
    ...(connector.sourceHandle ? { sourceHandle: connector.sourceHandle } : {}),
    ...(connector.targetHandle ? { targetHandle: connector.targetHandle } : {}),
    type: 'viewEdge',
    label: connector.label,
    animated: false,
    data: { path: connector.path, fontSize: connector.fontSize },
    style,
    markerStart: direction === 'backward' || direction === 'both' ? arrow : undefined,
    markerEnd: direction === 'forward' || direction === 'both' ? arrow : undefined,
  };
}

export interface ViewCanvasProps {
  demo: Demo;
  uuid: string;
}

export function ViewCanvas({ demo, uuid }: ViewCanvasProps) {
  const nodes = useMemo(() => demo.nodes.map(convertNode), [demo.nodes]);
  const edges = useMemo(() => demo.connectors.map(convertConnector), [demo.connectors]);

  return (
    <UuidContext.Provider value={uuid}>
      <div style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={true}
          fitView
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          proOptions={{ hideAttribution: false }}
        />
      </div>
    </UuidContext.Provider>
  );
}
