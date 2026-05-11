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

// Mirrors DetailSchema in apps/studio/src/schema.ts — `summary` is the short
// description rendered ON the node, `description` is the long one rendered
// in the detail panel (falls back to `summary` when absent).
export interface NodeDetail {
  filePath?: string;
  summary?: string;
  description?: string;
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
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
  cornerRadius?: number;
}

export interface NodeData extends NodeVisual {
  label: string;
  kind: string;
  stateSource: { kind: 'request' | 'event' };
  detail?: NodeDetail;
  playAction?: HttpAction;
  handlerModule?: string;
}

export type ShapeKind = 'rectangle' | 'ellipse' | 'sticky' | 'text';

export interface ShapeNodeData extends NodeVisual {
  shape: ShapeKind;
  label?: string;
}

// Decorative image node — embeds a base64 data URL on the canvas. Mirrors
// ImageNodeDataSchema in apps/studio/src/schema.ts; `image` is always a
// `data:image/...` URL (validated by Zod on the studio side).
export interface ImageNodeData extends NodeVisual {
  image: string;
  alt?: string;
}

// Decorative icon node — renders a Lucide glyph. Mirrors IconNodeDataSchema
// in apps/studio/src/schema.ts; unboxed (no border/cornerRadius/background)
// so it does NOT extend NodeVisual — only width/height are reused.
export interface IconNodeData {
  icon: string;
  color?: ColorToken;
  strokeWidth?: number;
  width?: number;
  height?: number;
  alt?: string;
  // US-002: optional visible caption rendered below the icon. Distinct from
  // `alt` (screen-reader text). Empty/absent → no caption rendered.
  label?: string;
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
  | (NodeBase & { type: 'iconNode'; data: IconNodeData });

export type ConnectorStyle = 'solid' | 'dashed' | 'dotted';
export type ConnectorDirection = 'forward' | 'backward' | 'both';
/** Path geometry — 'curve' (default bezier) vs 'step' (smoothstep / zigzag). */
export type ConnectorPath = 'curve' | 'step';

export interface ConnectorBase {
  id: string;
  source: string;
  target: string;
  /** Handle id (e.g. 't' / 'r' / 'b' / 'l') on the source node. */
  sourceHandle?: string;
  /** Handle id on the target node. */
  targetHandle?: string;
  /**
   * US-021: true when the source handle was chosen by the facing-handle
   * picker (e.g. body-drop fallback). When true, the auto-handle-rerouter
   * recomputes the side after node moves so the connector keeps facing the
   * other end. Absent / false → user-pinned, never overridden.
   */
  sourceHandleAutoPicked?: boolean;
  /** US-021: same as sourceHandleAutoPicked but for the target endpoint. */
  targetHandleAutoPicked?: boolean;
  label?: string;
  style?: ConnectorStyle;
  color?: ColorToken;
  direction?: ConnectorDirection;
  borderSize?: number;
  /** Path geometry — orthogonal to `style` (which is dash pattern). */
  path?: ConnectorPath;
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
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
  cornerRadius?: number;
  width?: number;
  height?: number;
  shape?: ShapeKind;
  /** iconNode-only: stroke color token. Lands at data.color. */
  color?: ColorToken;
  /** iconNode-only: glyph stroke width in [0.5, 4]. Lands at data.strokeWidth. */
  strokeWidth?: number;
  /** iconNode-only: accessible alt text. Lands at data.alt. */
  alt?: string;
  /** iconNode-only: kebab-case Lucide icon name. Lands at data.icon. */
  icon?: string;
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
  path?: ConnectorPath;
  kind?: Connector['kind'];
  eventName?: string;
  queueName?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  /** Reconnect: retarget this edge to a different source node. */
  source?: string;
  /** Reconnect: retarget this edge to a different target node. */
  target?: string;
  /**
   * Reconnect: pin the source endpoint to a specific source handle. `null`
   * (US-025) clears the field on disk — used by reconnect-to-body to drop a
   * previously-pinned handle id when the endpoint flips back to floating.
   */
  sourceHandle?: string | null;
  /** Reconnect: pin the target endpoint to a specific target handle. `null` clears. */
  targetHandle?: string | null;
  /**
   * US-025: `true`/absent means "render floating" against the line through
   * the two node centers; `false` means "render pinned to the stored handle
   * id". (Pre-US-025: `true` meant "rerouter-managed".)
   */
  sourceHandleAutoPicked?: boolean;
  /** US-025: same as sourceHandleAutoPicked but for the target endpoint. */
  targetHandleAutoPicked?: boolean;
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
  type: 'playNode' | 'stateNode' | 'shapeNode' | 'imageNode' | 'iconNode';
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
  sourceHandle?: string;
  targetHandle?: string;
  sourceHandleAutoPicked?: boolean;
  targetHandleAutoPicked?: boolean;
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

export type ReorderOp =
  | { op: 'forward' }
  | { op: 'backward' }
  | { op: 'toFront' }
  | { op: 'toBack' }
  | { op: 'toIndex'; index: number };

export const reorderNode = async (
  demoId: string,
  nodeId: string,
  body: ReorderOp,
): Promise<{ ok: true }> => {
  const res = await fetch(`/api/demos/${demoId}/nodes/${nodeId}/order`, {
    method: 'PATCH',
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
    throw new Error(
      errorBody?.error ?? `PATCH /api/demos/${demoId}/nodes/${nodeId}/order → ${res.status}`,
    );
  }
  return (await res.json()) as { ok: true };
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

export interface CreateProjectBody {
  name: string;
  folderPath: string;
}

export interface CreateProjectResult {
  id: string;
  slug: string;
  scaffolded: boolean;
}

export const createProject = async (body: CreateProjectBody): Promise<CreateProjectResult> => {
  const res = await fetch('/api/projects', {
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
    throw new Error(errorBody?.error ?? `POST /api/projects → ${res.status}`);
  }
  return (await res.json()) as CreateProjectResult;
};

export interface ResetDemoResult {
  ok: true;
  calledResetAction: boolean;
}

export const resetDemo = async (demoId: string): Promise<ResetDemoResult> => {
  const res = await fetch(`/api/demos/${demoId}/reset`, {
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
    throw new Error(errorBody?.error ?? `POST /api/demos/${demoId}/reset → ${res.status}`);
  }
  return (await res.json()) as ResetDemoResult;
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
