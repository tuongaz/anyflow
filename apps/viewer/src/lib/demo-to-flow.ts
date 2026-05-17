import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { colorTokenStyle } from './color-tokens';
import type { Connector, DemoNode } from '../types';

export const STYLE_BY_KIND: Record<Connector['kind'], { strokeDasharray?: string }> = {
  http: {},
  event: { strokeDasharray: '6 4' },
  queue: { strokeDasharray: '2 4' },
  default: {},
};

export const STYLE_BY_STYLE: Record<'solid' | 'dashed' | 'dotted', { strokeDasharray?: string }> =
  {
    solid: {},
    dashed: { strokeDasharray: '6 4' },
    dotted: { strokeDasharray: '2 4' },
  };

export function convertNode(node: DemoNode): Node {
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

export function convertConnector(connector: Connector): Edge {
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
