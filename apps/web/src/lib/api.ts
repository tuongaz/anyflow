export interface DemoSummary {
  id: string;
  slug: string;
  name: string;
  repoPath: string;
  lastModified: number;
  valid: boolean;
}

export interface HttpAction {
  kind: 'http';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  bodySchema?: unknown;
}

export interface DetailField {
  label: string;
  value: string;
}

export interface NodeDetail {
  filePath?: string;
  summary?: string;
  fields?: DetailField[];
  dynamicSource?: HttpAction;
}

export type ColorToken =
  | 'default'
  | 'slate'
  | 'blue'
  | 'green'
  | 'amber'
  | 'red'
  | 'purple'
  | 'pink';

// Visual fields shared by every node type (functional + decorative). All
// optional; mirrors NodeVisualBaseShape in apps/studio/src/schema.ts.
export interface NodeVisual {
  width?: number;
  height?: number;
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
  borderSize?: number;
  fontSize?: number;
}

export interface NodeData extends NodeVisual {
  label: string;
  kind: string;
  stateSource: { kind: 'request' | 'event' };
  detail?: NodeDetail;
  playAction?: HttpAction;
  handlerModule?: string;
}

export type ShapeKind = 'rectangle' | 'ellipse' | 'sticky';

export interface ShapeNodeData extends NodeVisual {
  shape: ShapeKind;
  label?: string;
}

interface NodeBase {
  id: string;
  position: { x: number; y: number };
}

export type DemoNode =
  | (NodeBase & { type: 'playNode'; data: NodeData })
  | (NodeBase & { type: 'stateNode'; data: NodeData })
  | (NodeBase & { type: 'shapeNode'; data: ShapeNodeData });

export type ConnectorStyle = 'solid' | 'dashed' | 'dotted';
export type ConnectorDirection = 'forward' | 'backward' | 'both';

export interface ConnectorBase {
  id: string;
  source: string;
  target: string;
  label?: string;
  style?: ConnectorStyle;
  color?: ColorToken;
  direction?: ConnectorDirection;
  borderSize?: number;
}

export interface HttpConnector extends ConnectorBase {
  kind: 'http';
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
}

export interface EventConnector extends ConnectorBase {
  kind: 'event';
  eventName: string;
}

export interface QueueConnector extends ConnectorBase {
  kind: 'queue';
  queueName: string;
}

export interface DefaultConnector extends ConnectorBase {
  kind: 'default';
}

export type Connector = HttpConnector | EventConnector | QueueConnector | DefaultConnector;

export interface Demo {
  version: 1;
  name: string;
  nodes: DemoNode[];
  connectors: Connector[];
}

export interface DemoDetail {
  id: string;
  slug: string;
  name: string;
  filePath: string;
  demo: Demo | null;
  valid: boolean;
  error: string | null;
}

export const fetchDemos = async (): Promise<DemoSummary[]> => {
  const res = await fetch('/api/demos');
  if (!res.ok) throw new Error(`GET /api/demos failed: ${res.status}`);
  return (await res.json()) as DemoSummary[];
};

export const fetchDemoDetail = async (id: string): Promise<DemoDetail> => {
  const res = await fetch(`/api/demos/${id}`);
  if (!res.ok) throw new Error(`GET /api/demos/${id} failed: ${res.status}`);
  return (await res.json()) as DemoDetail;
};

export interface PlayResult {
  runId: string;
  status?: number;
  body?: unknown;
  error?: string;
}

export interface NodeDetailResult {
  status?: number;
  body?: unknown;
  error?: string;
}

export const fetchNodeDetail = async (
  demoId: string,
  nodeId: string,
): Promise<NodeDetailResult> => {
  const res = await fetch(`/api/demos/${demoId}/nodes/${nodeId}/detail`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `POST /api/demos/${demoId}/nodes/${nodeId}/detail → ${res.status}`,
    );
  }
  return (await res.json()) as NodeDetailResult;
};

export interface UpdatePositionResult {
  ok: boolean;
  position: { x: number; y: number };
}

export const updateNodePosition = async (
  demoId: string,
  nodeId: string,
  position: { x: number; y: number },
): Promise<UpdatePositionResult> => {
  const res = await fetch(`/api/demos/${demoId}/nodes/${nodeId}/position`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(position),
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `PATCH /api/demos/${demoId}/nodes/${nodeId}/position → ${res.status}`,
    );
  }
  return (await res.json()) as UpdatePositionResult;
};

export interface UpdateNodeBody {
  position?: { x: number; y: number };
  label?: string;
  detail?: NodeDetail;
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
  borderSize?: number;
  fontSize?: number;
  width?: number;
  height?: number;
  shape?: ShapeKind;
}

export const updateNode = async (
  demoId: string,
  nodeId: string,
  patch: UpdateNodeBody,
): Promise<{ ok: true }> => {
  const res = await fetch(`/api/demos/${demoId}/nodes/${nodeId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `PATCH /api/demos/${demoId}/nodes/${nodeId} → ${res.status}`,
    );
  }
  return (await res.json()) as { ok: true };
};

export interface UpdateConnectorBody {
  label?: string;
  style?: ConnectorStyle;
  color?: ColorToken;
  direction?: ConnectorDirection;
  borderSize?: number;
  kind?: Connector['kind'];
  eventName?: string;
  queueName?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  /** Reconnect: retarget this edge to a different source node. */
  source?: string;
  /** Reconnect: retarget this edge to a different target node. */
  target?: string;
}

export const updateConnector = async (
  demoId: string,
  connId: string,
  patch: UpdateConnectorBody,
): Promise<{ ok: true }> => {
  const res = await fetch(`/api/demos/${demoId}/connectors/${connId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `PATCH /api/demos/${demoId}/connectors/${connId} → ${res.status}`,
    );
  }
  return (await res.json()) as { ok: true };
};

export interface CreateNodeBody {
  id?: string;
  type: 'playNode' | 'stateNode' | 'shapeNode';
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export const createNode = async (
  demoId: string,
  node: CreateNodeBody,
): Promise<{ ok: true; id: string }> => {
  const res = await fetch(`/api/demos/${demoId}/nodes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(node),
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `POST /api/demos/${demoId}/nodes → ${res.status}`);
  }
  return (await res.json()) as { ok: true; id: string };
};

export interface CreateConnectorBody {
  id?: string;
  source: string;
  target: string;
  kind?: Connector['kind'];
  label?: string;
  style?: ConnectorStyle;
  color?: ColorToken;
  direction?: ConnectorDirection;
  eventName?: string;
  queueName?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
}

export const createConnector = async (
  demoId: string,
  body: CreateConnectorBody,
): Promise<{ ok: true; id: string }> => {
  const res = await fetch(`/api/demos/${demoId}/connectors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `POST /api/demos/${demoId}/connectors → ${res.status}`);
  }
  return (await res.json()) as { ok: true; id: string };
};

export const deleteNode = async (demoId: string, nodeId: string): Promise<{ ok: true }> => {
  const res = await fetch(`/api/demos/${demoId}/nodes/${nodeId}`, { method: 'DELETE' });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `DELETE /api/demos/${demoId}/nodes/${nodeId} → ${res.status}`,
    );
  }
  return (await res.json()) as { ok: true };
};

export const deleteConnector = async (demoId: string, connId: string): Promise<{ ok: true }> => {
  const res = await fetch(`/api/demos/${demoId}/connectors/${connId}`, { method: 'DELETE' });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `DELETE /api/demos/${demoId}/connectors/${connId} → ${res.status}`,
    );
  }
  return (await res.json()) as { ok: true };
};

export const playNode = async (demoId: string, nodeId: string): Promise<PlayResult> => {
  const res = await fetch(`/api/demos/${demoId}/play/${nodeId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `POST /api/demos/${demoId}/play/${nodeId} → ${res.status}`);
  }
  return (await res.json()) as PlayResult;
};
