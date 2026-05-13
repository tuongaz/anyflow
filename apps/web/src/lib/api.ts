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
  /**
   * US-019: when true the node is frozen — cannot be dragged, resized, or
   * deleted by accident — and renders a lock badge in its top-right corner.
   * Absent → unlocked default. Mirrored explicitly into IconNodeData /
   * GroupNodeData (those variants don't extend NodeVisual).
   */
  locked?: boolean;
}

// Three-field consolidation: free-text metadata fields available on every
// node variant. `description` is the short body text rendered on the canvas
// under the node header (and as light-bold text in the sidebar); `detail` is
// the long-form body rendered only in the sidebar. Both optional. Mirrors
// `NodeDescriptionBaseShape` in apps/studio/src/schema.ts.
export interface NodeDescription {
  description?: string;
  detail?: string;
}

export interface NodeData extends NodeVisual, NodeDescription {
  name: string;
  kind: string;
  stateSource: { kind: 'request' | 'event' };
  playAction?: HttpAction;
  handlerModule?: string;
}

// US-009: `database` is the first illustrative shape — rendered via inline
// SVG in `apps/web/src/components/nodes/shapes/database.tsx`, the wrapper
// chrome is suppressed (SVG owns border + fill). Keep this union in sync with
// `ShapeKindSchema` in `apps/studio/src/schema.ts`.
export type ShapeKind = 'rectangle' | 'ellipse' | 'sticky' | 'text' | 'database';

export interface ShapeNodeData extends NodeVisual, NodeDescription {
  shape: ShapeKind;
  name?: string;
}

// Decorative image node — references a file under `<project>/.anydemo/` by
// relative path (US-004 hard-cut from base64). Mirrors ImageNodeDataSchema in
// apps/studio/src/schema.ts; the renderer fetches via the file-serving
// endpoint at `GET /api/projects/:id/files/:path`.
// US-014: optional `borderWidth` (1–8) mirrors `GroupNodeData.borderWidth` so
// the property panel can drive an image border with the same control set.
// `borderColor` and `borderStyle` come via NodeVisual.
export interface ImageNodeData extends NodeVisual, NodeDescription {
  path: string;
  alt?: string;
  borderWidth?: number;
  /**
   * US-008: transient overlay flag set on the optimistic node placed by the
   * OS-image drop handler before the file has finished uploading. Lives only
   * in the in-memory nodeOverrides map — never serialized to disk (cleared
   * before createNode is called). Leading underscore marks it private.
   */
  _uploading?: boolean;
  /**
   * US-008: transient overlay flag set when the upload POST failed. The
   * renderer shows a 'click to retry' placeholder and clicking dispatches the
   * retry callback. Cleared on successful retry. Never serialized.
   */
  _uploadError?: string;
}

// Decorative icon node — renders a Lucide glyph. Mirrors IconNodeDataSchema
// in apps/studio/src/schema.ts; unboxed (no border/cornerRadius/background)
// so it does NOT extend NodeVisual — only width/height are reused.
export interface IconNodeData extends NodeDescription {
  icon: string;
  color?: ColorToken;
  strokeWidth?: number;
  width?: number;
  height?: number;
  alt?: string;
  // US-002: optional visible caption rendered below the icon. Distinct from
  // `alt` (screen-reader text). Empty/absent → no caption rendered.
  name?: string;
  /** US-019: lock state mirror — see NodeVisual.locked. */
  locked?: boolean;
}

// Decorative htmlNode — references author-written HTML at
// `<project>/.anydemo/<htmlPath>` (US-011 schema, US-014 renderer). The
// renderer fetches the file via the project file-serving endpoint, sanitizes
// the contents via `sanitizeHtml`, and injects the result. Mirrors
// `HtmlNodeDataSchema` in `apps/studio/src/schema.ts`.
export interface HtmlNodeData extends NodeVisual, NodeDescription {
  htmlPath: string;
  name?: string;
}

// US-011: container node grouping other nodes via their `parentId`. No
// semantic payload; chrome (dashed border, transparent fill) lives in CSS.
// `width`/`height` size the group's bounding box for the renderer.
export interface GroupNodeData extends NodeDescription {
  name?: string;
  width?: number;
  height?: number;
  /** US-019: lock state mirror — see NodeVisual.locked. */
  locked?: boolean;
  /** US-001/US-005: group chrome overrides. When any field is absent, the
   * default chrome from `apps/web/src/index.css` (`.react-flow__node-group`:
   * 1px dashed, transparent fill) applies. Field naming follows the PRD
   * (`borderWidth`, NOT `borderSize` like shape nodes use). */
  backgroundColor?: ColorToken;
  borderColor?: ColorToken;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  /** US-008: transient flag injected by demo-canvas when the user has entered
   * this group via double-click. Never persisted to disk — drives the
   * property-panel "group style" branch and the `[data-active]` CSS chrome. */
  isActive?: boolean;
}

interface NodeBase {
  id: string;
  position: { x: number; y: number };
  /**
   * US-011: optional parent-node id. When set, React Flow positions this
   * node relative to the parent's top-left and drags the parent + children
   * together. Mirrors the optional `parentId` on every node variant in
   * apps/studio/src/schema.ts.
   */
  parentId?: string;
}

export type DemoNode =
  | (NodeBase & { type: 'playNode'; data: NodeData })
  | (NodeBase & { type: 'stateNode'; data: NodeData })
  | (NodeBase & { type: 'shapeNode'; data: ShapeNodeData })
  | (NodeBase & { type: 'imageNode'; data: ImageNodeData })
  | (NodeBase & { type: 'iconNode'; data: IconNodeData })
  | (NodeBase & { type: 'group'; data: GroupNodeData })
  | (NodeBase & { type: 'htmlNode'; data: HtmlNodeData });

export type ConnectorStyle = 'solid' | 'dashed' | 'dotted';
export type ConnectorDirection = 'forward' | 'backward' | 'both' | 'none';
/** Path geometry — 'curve' (default bezier) vs 'step' (smoothstep / zigzag). */
export type ConnectorPath = 'curve' | 'step';

/**
 * US-006: pinned endpoint position on an edge. Mirrors `EdgePinSchema` in
 * apps/studio/src/schema.ts. `side` names which of the four perimeter sides
 * of the connected node the endpoint sits on; `t` is the parameterized
 * position along that side, in [0, 1]. Top/bottom: 0 = left, 1 = right.
 * Left/right: 0 = top, 1 = bottom.
 */
export type EdgePinSide = 'top' | 'right' | 'bottom' | 'left';
export interface EdgePin {
  side: EdgePinSide;
  t: number;
}

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
  /**
   * US-006: explicit perimeter pin for the source endpoint. When set, the
   * endpoint is anchored to `(side, t)` against the live source-node bbox
   * and does not drift as either node moves or resizes. Absent → floating /
   * handle-based endpoint behavior (back-compat).
   */
  sourcePin?: EdgePin;
  /** US-006: same as sourcePin but for the target endpoint. */
  targetPin?: EdgePin;
  label?: string;
  style?: ConnectorStyle;
  color?: ColorToken;
  direction?: ConnectorDirection;
  borderSize?: number;
  /** Path geometry — orthogonal to `style` (which is dash pattern). */
  path?: ConnectorPath;
  /** US-018: per-connector label font size in px. Absent → 11px default. */
  fontSize?: number;
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
  /**
   * US-012: set or clear the node's parent (group). `null` is the wire-format
   * signal to clear the field on disk (mirrors sourcePin/targetPin); a string
   * sets it; `undefined` leaves it untouched. Final validity (reference + no
   * self-parent) is gated by DemoSchema's superRefine on the studio side.
   */
  parentId?: string | null;
  name?: string;
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
  borderSize?: number;
  /** US-008: group chrome border-thickness (1–8). Distinct from shape nodes'
   * open-ended `borderSize` — see `GroupNodeData.borderWidth`. */
  borderWidth?: number;
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
  /** US-019: lock state. true freezes the node; false unlocks. */
  locked?: boolean;
  /** Short body text rendered on the canvas and as light-bold in the sidebar.
   * Lands at data.description. Empty string clears the field on disk. */
  description?: string;
  /** Long-form sidebar-only body text. Lands at data.detail. Empty string
   * clears the field on disk. */
  detail?: string;
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
  /** US-018: per-connector label font size in px. */
  fontSize?: number;
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
  /**
   * US-007: pin the source endpoint at `(side, t)` along the source node's
   * perimeter. `null` (wire-format) clears any stored pin so the endpoint
   * reverts to floating/handle-pinned behavior; `undefined` leaves the field
   * untouched.
   */
  sourcePin?: EdgePin | null;
  /** US-007: same as sourcePin but for the target endpoint. */
  targetPin?: EdgePin | null;
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
  type: 'playNode' | 'stateNode' | 'shapeNode' | 'imageNode' | 'iconNode' | 'group' | 'htmlNode';
  position: { x: number; y: number };
  data: Record<string, unknown>;
  /** US-011: optional parent-node id (must reference an existing node). */
  parentId?: string;
}

export const createNode = async (
  demoId: string,
  node: CreateNodeBody,
): Promise<{ ok: true; id: string; node: Record<string, unknown> }> => {
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
  return (await res.json()) as { ok: true; id: string; node: Record<string, unknown> };
};

export interface CreateConnectorBody {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  sourceHandleAutoPicked?: boolean;
  targetHandleAutoPicked?: boolean;
  // Per-endpoint perimeter pin. When set, the connector's endpoint is
  // anchored at `(side, t)` on the connected node's bbox. Used when a
  // create-from-body-drop fallback projects the cursor onto the target
  // node's perimeter (user rule: "cursor over node → closest perimeter
  // point and use that").
  sourcePin?: EdgePin;
  targetPin?: EdgePin;
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

export interface UploadImageResult {
  path: string;
}

/**
 * US-018: response shape for the two project-file shell-out endpoints
 * (`/files/open` and `/files/reveal`). The backend always returns the
 * resolved absolute path so the frontend can copy-to-clipboard when the
 * spawn failed or `$EDITOR` is unset — both success and soft-fail include
 * `absPath`. `ok: false` is NOT thrown; the helper resolves with the
 * envelope so the caller can branch on the fallback.
 */
export interface FileActionResult {
  ok: boolean;
  absPath: string;
  error?: string;
}

const requestFileAction = async (
  projectId: string,
  action: 'open' | 'reveal',
  path: string,
): Promise<FileActionResult> => {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  // 200 OK with `ok: false` is the spawn-failure / EDITOR-unset fallback —
  // resolve so the caller can show the clipboard-copy affordance. 404 is the
  // file-missing soft-fail which also includes `absPath`; resolve as
  // `{ ok: false }` so the UI can surface the same fallback. Anything else
  // (400 traversal/absolute reject, 404 unknown project, 500) throws.
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // ignore
  }
  if (res.ok) {
    return {
      ok: body?.ok === true,
      absPath: typeof body?.absPath === 'string' ? body.absPath : '',
      error: typeof body?.error === 'string' ? body.error : undefined,
    };
  }
  if (res.status === 404 && typeof body?.absPath === 'string') {
    return {
      ok: false,
      absPath: body.absPath,
      error: typeof body?.error === 'string' ? body.error : 'file not found',
    };
  }
  const errMsg = typeof body?.error === 'string' ? body.error : undefined;
  throw new Error(errMsg ?? `POST /api/projects/${projectId}/files/${action} → ${res.status}`);
};

/**
 * US-018: ask the backend to open the given project-scoped file in `$EDITOR`.
 * Always resolves with the absolute path so the caller can copy-to-clipboard
 * on the fallback case (ok:false). Throws only on transport / path-validation
 * errors.
 */
export const openProjectFile = async (projectId: string, path: string): Promise<FileActionResult> =>
  requestFileAction(projectId, 'open', path);

/**
 * US-018: ask the backend to reveal the given project-scoped file in the OS
 * file manager (Finder on macOS, Explorer on Windows, xdg-open on Linux).
 * Same fallback shape as `openProjectFile`.
 */
export const revealProjectFile = async (
  projectId: string,
  path: string,
): Promise<FileActionResult> => requestFileAction(projectId, 'reveal', path);

/**
 * US-008: POST a single image File to the project's upload endpoint (US-007).
 * `filename` overrides the File's own `.name` for the server-side slugging.
 * The browser sets the multipart boundary automatically — never pass an
 * explicit `content-type` header.
 */
export const uploadImageFile = async (
  projectId: string,
  file: File,
  filename: string,
): Promise<UploadImageResult> => {
  const form = new FormData();
  form.append('file', file);
  form.append('filename', filename);
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `POST /api/projects/${projectId}/files/upload → ${res.status}`,
    );
  }
  return (await res.json()) as UploadImageResult;
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
