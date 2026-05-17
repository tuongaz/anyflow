export type ColorToken =
  | 'default'
  | 'slate'
  | 'blue'
  | 'green'
  | 'amber'
  | 'red'
  | 'purple'
  | 'pink';

export interface NodeVisual {
  width?: number;
  height?: number;
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
  borderSize?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
  textColor?: ColorToken;
  cornerRadius?: number;
  locked?: boolean;
}

export interface NodeDescription {
  description?: string;
  detail?: string;
}

export interface NodeData extends NodeVisual, NodeDescription {
  name: string;
  kind: string;
  stateSource: { kind: 'request' | 'event' };
}

export type ShapeKind =
  | 'rectangle'
  | 'ellipse'
  | 'sticky'
  | 'text'
  | 'database'
  | 'server'
  | 'user'
  | 'queue'
  | 'cloud';

export interface ShapeNodeData extends NodeVisual, NodeDescription {
  shape: ShapeKind;
  name?: string;
}

export interface ImageNodeData extends NodeVisual, NodeDescription {
  path: string;
  alt?: string;
  borderWidth?: number;
}

export interface IconNodeData extends NodeDescription {
  icon: string;
  color?: ColorToken;
  strokeWidth?: number;
  width?: number;
  height?: number;
  alt?: string;
  name?: string;
  locked?: boolean;
}

export interface HtmlNodeData extends NodeVisual, NodeDescription {
  htmlPath: string;
  name?: string;
}

interface NodeBase {
  id: string;
  position: { x: number; y: number };
}

export type DemoNode =
  | (NodeBase & { type: 'playNode'; data: NodeData })
  | (NodeBase & { type: 'stateNode'; data: NodeData })
  | (NodeBase & { type: 'shapeNode'; data: ShapeNodeData })
  | (NodeBase & { type: 'imageNode'; data: ImageNodeData })
  | (NodeBase & { type: 'iconNode'; data: IconNodeData })
  | (NodeBase & { type: 'htmlNode'; data: HtmlNodeData });

export interface ConnectorBase {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  style?: 'solid' | 'dashed' | 'dotted';
  color?: ColorToken;
  direction?: 'forward' | 'backward' | 'both' | 'none';
  borderSize?: number;
  path?: 'curve' | 'step';
  fontSize?: number;
}

export type Connector =
  | (ConnectorBase & { kind: 'http'; method?: string; url?: string })
  | (ConnectorBase & { kind: 'event'; eventName: string })
  | (ConnectorBase & { kind: 'queue'; queueName: string })
  | (ConnectorBase & { kind: 'default' });

export interface Demo {
  version: 1;
  name: string;
  nodes: DemoNode[];
  connectors: Connector[];
}

export interface FlowListItem {
  uuid: string;
  name: string;
  createdAt: string;
  demo: Demo;
}

export interface FlowsResponse {
  flows: FlowListItem[];
  total: number;
  page: number;
  totalPages: number;
}
