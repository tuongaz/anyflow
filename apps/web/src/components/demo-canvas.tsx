import { CanvasToolbar, TOOLBAR_SHAPES } from '@/components/canvas-toolbar';
import { EditableEdge, type EditableEdgeData } from '@/components/edges/editable-edge';
import { GroupNode } from '@/components/nodes/group-node';
import { IconNode } from '@/components/nodes/icon-node';
import { IMAGE_DEFAULT_SIZE, ImageNode } from '@/components/nodes/image-node';
import { PlayNode } from '@/components/nodes/play-node';
import {
  SHAPE_DEFAULT_SIZE,
  ShapeNode,
  shapeChromeClass,
  shapeChromeStyle,
} from '@/components/nodes/shape-node';
import { StateNode } from '@/components/nodes/state-node';
import type { NodeStatus } from '@/components/nodes/status-pill';
import {
  type ConnectorStylePatch,
  type NodeStylePatch,
  StyleStrip,
} from '@/components/style-strip';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import type { NodeRuns } from '@/hooks/use-node-runs';
import type { OverrideMap } from '@/hooks/use-pending-overrides';
import type { Connector, DemoNode, ReorderOp, ShapeKind } from '@/lib/api';
import { handleCanvasDrop, isCandidateImageDrag } from '@/lib/canvas-drop';
import { connectorToEdge } from '@/lib/connector-to-edge';
import { type GroupableNode, selectGroupableSet, selectUngroupableSet } from '@/lib/group-ops';
import { cn } from '@/lib/utils';
import {
  Background,
  type Connection,
  type ConnectionLineComponentProps,
  Controls,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type HandleType,
  type Node,
  type NodeChange,
  Panel,
  ReactFlow,
  type ReactFlowInstance,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  getSmoothStepPath,
  useStore,
  useStoreApi,
} from '@xyflow/react';
import {
  type ComponentType,
  type PointerEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import '@xyflow/react/dist/style.css';

export interface DemoCanvasProps {
  nodes: DemoNode[];
  connectors: Connector[];
  /** Currently selected node ids (US-019: multi-select). */
  selectedNodeIds: readonly string[];
  /** Currently selected connector ids (US-019: multi-select). */
  selectedConnectorIds: readonly string[];
  /**
   * Fired whenever React Flow's internal selection changes (click, marquee,
   * Shift/Cmd-click toggle). The parent mirrors the arrays into its own state.
   */
  onSelectionChange?: (nodeIds: string[], connectorIds: string[]) => void;
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
  /**
   * Optimistic per-connector overrides. Shallow-merged over the server
   * `connectors` so style/color/direction edits are visible immediately
   * (without waiting for the SSE echo of the file rewrite).
   */
  connectorOverrides?: OverrideMap<Connector>;
  /** Fired once per drag-stop with the node's final position. */
  onNodePositionChange?: (nodeId: string, position: { x: number; y: number }) => void;
  /**
   * US-013: atomic multi-node drag-stop. Fired once per drag-stop with EVERY
   * moved node's final position when the gesture moves more than one node.
   * The parent commits the whole batch as a single undo entry so one Cmd+Z
   * reverts the entire group move. Wiring this is what enables the canvas to
   * route multi-node drags through the batch path; absent → the canvas falls
   * back to per-node `onNodePositionChange` calls (legacy single-undo-per-id
   * behavior).
   */
  onNodePositionsChange?: (updates: { id: string; position: { x: number; y: number } }[]) => void;
  /**
   * Fired once per resize-stop with the node's final dimensions AND position.
   * Wiring this enables NodeResizer's resize handles inside each custom node.
   * US-012: top/left handle drags shift x/y so the opposite corner stays
   * anchored — persistence must store both the new size and new position.
   */
  onNodeResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  /** Persist a new node label (PATCH /nodes/:id { label }). */
  onNodeLabelChange?: (nodeId: string, label: string) => void;
  /** Persist a new node description on detail.summary. */
  onNodeDescriptionChange?: (nodeId: string, summary: string) => void;
  /** Persist a new connector label (PATCH /connectors/:id { label }). */
  onConnectorLabelChange?: (connId: string, label: string) => void;
  /**
   * Commit a new shape node from the bottom-toolbar draw flow. Wiring this
   * enables the toolbar; absent → toolbar is hidden.
   */
  onCreateShapeNode?: (
    shape: ShapeKind,
    position: { x: number; y: number },
    dims: { width: number; height: number },
  ) => void;
  /**
   * Commit a new connector from a handle-drag gesture. Wiring this enables
   * `nodesConnectable` on the React Flow instance; absent → handles are
   * read-only. Self-connections (source === target) are rejected here so the
   * parent never sees them.
   *
   * US-025: new connectors are always floating — the parent persists them
   * with `sourceHandleAutoPicked: true` / `targetHandleAutoPicked: true` and
   * no handle ids. A user pins an endpoint by dragging it onto a specific
   * handle dot via reconnect.
   */
  onCreateConnector?: (source: string, target: string) => void;
  /**
   * Reattach an existing connector's source or target to a different node, or
   * to a different handle on the same node. Wired enables React Flow's edge
   * reconnect gesture: drag an edge endpoint onto another handle to call this
   * with the new source/target/handle ids. The patch only includes the fields
   * that changed; same-node handle changes surface as `sourceHandle`-only or
   * `targetHandle`-only patches (US-002).
   *
   * US-025: a precise-handle-dot drop pins the moved endpoint
   * (`sourceHandle`/`targetHandle` set, `*HandleAutoPicked: false`). A
   * body-drop reconnect keeps the endpoint floating
   * (`sourceHandle`/`targetHandle: null` to clear any prior pin,
   * `*HandleAutoPicked: true`). `null` is the wire-format signal to clear
   * the field on disk.
   */
  onReconnectConnector?: (
    connectorId: string,
    patch: {
      source?: string;
      target?: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
      sourceHandleAutoPicked?: boolean;
      targetHandleAutoPicked?: boolean;
    },
  ) => void;
  /**
   * Reorder a node within demo.nodes[]. Wiring this enables the right-click
   * context-menu z-order actions (Bring to front, Bring forward, Send backward,
   * Send to back). The parent owns the optimistic + persistence wiring; the
   * canvas just translates the menu pick into this callback.
   */
  onReorderNode?: (nodeId: string, op: ReorderOp) => void;
  /**
   * Delete a node from the canvas. Wiring this enables the right-click
   * context menu's Delete entry; the same callback DetailPanel invokes for
   * keyboard-driven deletes.
   */
  onDeleteNode?: (nodeId: string) => void;
  /**
   * Copy a node into the in-app clipboard. Wiring this enables the
   * right-click context menu's Copy entry. The canvas hands the right-clicked
   * node id directly; multi-select copy is up to the parent (today's parent
   * supports single-select only).
   */
  onCopyNode?: (nodeId: string) => void;
  /**
   * Paste from the in-app clipboard at a specific flow-space position (cursor
   * location of the right-click). When the parent's clipboard is empty the
   * call is a no-op. Keyboard paste (Ctrl/Cmd+V) is owned by the parent and
   * doesn't go through this prop — the parent uses a +24,+24 offset there.
   */
  onPasteAt?: (flowPos: { x: number; y: number }) => void;
  /** True when the in-app clipboard has content (drives the Paste item's
   * disabled state). Snapshot-checked at menu-open time, not subscribed —
   * the menu re-renders on every open via `contextMenuPos` setState. */
  hasClipboard?: boolean;
  /**
   * Currently selected nodes (with optimistic overrides applied) — drives the
   * canvas style strip's controls and fan-out apply (US-019). Empty when no
   * node is selected.
   */
  selectedNodes?: DemoNode[];
  /**
   * Currently selected connectors (with optimistic overrides applied) — drives
   * the canvas style strip's controls and fan-out apply (US-019). Empty when
   * no connector is selected.
   */
  selectedConnectors?: Connector[];
  /** Apply a style patch to a node (border/background/font). */
  onStyleNode?: (nodeId: string, patch: NodeStylePatch) => void;
  /** Live preview override during a slider drag (no PATCH/undo). */
  onStyleNodePreview?: (nodeId: string, patch: NodeStylePatch) => void;
  /** US-008: atomic multi-node apply (single undo entry). */
  onStyleNodes?: (nodeIds: string[], patch: NodeStylePatch) => void;
  /** US-008: live preview for a multi-node selection. */
  onStyleNodesPreview?: (nodeIds: string[], patch: NodeStylePatch) => void;
  /** Apply a style patch to a connector (color/style/direction/path/width). */
  onStyleConnector?: (connId: string, patch: ConnectorStylePatch) => void;
  /** Live preview override during a slider drag (no PATCH/undo). */
  onStyleConnectorPreview?: (connId: string, patch: ConnectorStylePatch) => void;
  /**
   * Receive the React Flow instance once it has mounted (US-024). Lets the
   * page-level keyboard handler call zoom methods (`fitView`, `zoomIn`,
   * `zoomOut`) without owning the canvas itself. Called once per mount.
   */
  onRfInit?: (instance: ReactFlowInstance) => void;
  /**
   * Run the auto-layout (Tidy) action against the canvas (US-026). When
   * omitted, the toolbar's Tidy button renders disabled (no demo loaded).
   * Scope is decided by the caller (selection-aware in `demo-view`).
   */
  onTidy?: () => void;
  /**
   * US-003: fired on a real click on a node (mousedown + mouseup without
   * crossing the drag threshold). React Flow's `onNodeClick` fires only for
   * actual clicks — drags don't trigger it — so this is the channel parents
   * use to drive the detail panel without coupling it to selection.
   */
  onNodeClick?: (nodeId: string) => void;
  /**
   * US-003: fired on a real click on a connector. Mirrors `onNodeClick` for
   * edges — used by the parent to open the detail panel for an edge without
   * tying panel state to multi-select changes.
   */
  onConnectorClick?: (connectorId: string) => void;
  /**
   * US-003: fired on a click on the empty canvas pane. Used by the parent to
   * close the detail panel and clear the open-target.
   */
  onPaneClick?: () => void;
  /**
   * US-015: commit a new shape node at the drop position AND wire a connector
   * from the drag's source node to the new node, all as a single undo entry.
   * Wiring this enables the drop-on-pane popover; absent → drop on pane no-ops
   * (legacy behaviour). The parent owns id generation, optimistic overrides,
   * persistence, and the single undo-stack push. The canvas hands over the
   * drag's source node id, the drop position in flow space, and the picked
   * shape; the new node's id is owned by the parent so it can drive
   * `pendingEditNodeId` for the auto-edit-on-mount affordance.
   */
  onCreateAndConnectFromPane?: (args: {
    sourceNodeId: string;
    position: { x: number; y: number };
    shape: ShapeKind;
  }) => void;
  /**
   * US-015: id of the most recently created node that should mount directly in
   * inline label-edit mode (the drop-popover create flow). Injected into the
   * matching node's data as `autoEditOnMount: true`; consumed once on mount by
   * the node component. Subsequent renders are unaffected even if the parent
   * leaves the id pinned.
   */
  pendingEditNodeId?: string | null;
  /**
   * US-010 / US-011: commit a new imageNode created from paste-from-clipboard
   * or drag-drop file ingestion. The canvas owns the listeners + screen→flow
   * translation; the parent owns id generation, optimistic overrides,
   * persistence, and the undo entry (mirrors `onCreateShapeNode`). When
   * omitted both ingestion paths are inert.
   */
  onCreateImageNode?: (image: string, position: { x: number; y: number }) => void;
  /**
   * US-012: ingest an http(s) URL dropped on the canvas (e.g. dragging an
   * <img> from a webpage). The canvas extracts the URL from `text/uri-list`
   * or `text/plain` and translates the drop point to flow space; the parent
   * owns the fetch → blob → base64 conversion (so fetch failures can flow
   * through the same `editError` surface as other create-node errors). When
   * omitted, URL drags are ignored.
   */
  onIngestImageUrl?: (url: string, position: { x: number; y: number }) => void;
  /**
   * US-013: capture the canvas viewport and download it as an SVG file.
   * Wiring this enables the Export SVG button in the canvas toolbar; absent →
   * button is hidden. The parent owns the fitView/setViewport dance, the
   * html-to-image capture, and the download trigger so the canvas stays free
   * of dependency on the export library.
   */
  onExportSvg?: () => Promise<unknown> | unknown;
  /**
   * US-014: capture the canvas viewport and download it as a PDF file.
   * Wiring this enables the Export PDF button in the canvas toolbar; absent →
   * button is hidden. The parent owns the fitView/setViewport dance, the
   * html-to-image capture, and the jsPDF generation so the canvas stays free
   * of dependency on the export libraries.
   */
  onExportPdf?: () => Promise<unknown> | unknown;
  /**
   * US-013/015 (icon picker): controlled-open state for the toolbar's Insert
   * icon popover. Wired through to `<CanvasToolbar>` unchanged. The parent
   * (demo-view) owns the state slice + pick handler so the detail panel,
   * the right-click "Change icon" menu item (US-003) can all dispatch into
   * the same picker.
   */
  iconPickerOpen?: boolean;
  /** Open the picker in insert mode (toolbar button click). */
  onOpenIconPicker?: () => void;
  /** Close the picker (Esc / outside click / post-pick). */
  onCloseIconPicker?: () => void;
  /** Handle a tile-pick from the popover (mode + viewport are owned upstream). */
  onPickIcon?: (name: string) => void;
  /**
   * US-003: dispatched by the right-click "Change icon" menu item on an
   * iconNode. The canvas uses this from the menu's onSelect to request the
   * picker open in replace mode for that node. Same handler the detail
   * panel's "Change icon…" button uses (US-015), just a different entry
   * point. Absent → the menu item is hidden. (Previously US-016 also wired
   * this onto iconNode dblclick; US-004 replaced that path with inline
   * label edit and the picker is now reachable only via the right-click
   * menu and the StyleStrip button.)
   */
  onRequestIconReplace?: (nodeId: string) => void;
  /**
   * US-007: persist a new perimeter pin for the named endpoint. Wired enables
   * the pin-drag affordance on the visible endpoint dots: dragging clamps
   * the cursor onto the perimeter, pointer-up calls this with the final
   * `(side, t)`. Parent owns the optimistic override, PATCH, and undo entry.
   * Absent → dragging the dot is inert.
   */
  onPinEndpoint?: (
    connectorId: string,
    kind: 'source' | 'target',
    pin: { side: 'top' | 'right' | 'bottom' | 'left'; t: number },
  ) => void;
  /**
   * US-007: clear an existing pin for the named endpoint. Wired enables the
   * right-click "Unpin" context menu item on a pinned endpoint dot. Parent
   * owns the optimistic override, PATCH (with `null` to clear on disk), and
   * undo entry. Absent → the menu item is hidden.
   */
  onUnpinEndpoint?: (connectorId: string, kind: 'source' | 'target') => void;
  /**
   * US-012: wrap a multi-selection into a new group node. Wired enables the
   * "Group" item in the multi-selection right-click menu (visible when ≥ 2
   * of the selected nodes are groupable — i.e. not already parented and not
   * group nodes themselves). The parent owns id generation, optimistic
   * overrides, persistence, and the single undo entry; the canvas just
   * forwards the current selection at click time.
   */
  onGroupNodes?: (selectedNodeIds: string[]) => void;
  /**
   * US-013: dissolve every group node in the current selection. Wired enables
   * the "Ungroup" item in the right-click menu (visible when ≥ 1 of the
   * selected nodes is a group — mutually exclusive with the "Group" item
   * above). Parent owns persistence + the single undo entry covering the
   * whole batch (children's parentId cleared, absolute positions restored,
   * group nodes removed).
   */
  onUngroupSelection?: (selectedNodeIds: string[]) => void;
}

// Below this threshold we treat the gesture as an accidental click / tiny
// nudge and create the shape at SHAPE_DEFAULT_SIZE instead — a single click
// still produces a usable node rather than a 0×0 ghost.
const MIN_DRAW_SIZE = 40;

/**
 * Resolve the cursor's screen-space coordinates from the mouse/touch event
 * union React Flow forwards into onConnectEnd / onReconnectEnd. Returns null
 * when neither branch carries a position (touch event with empty changedTouches
 * is the only practical case).
 */
const cursorFromConnectEvent = (
  e: MouseEvent | TouchEvent,
): { clientX: number; clientY: number } | null => {
  if ('clientX' in e) return { clientX: e.clientX, clientY: e.clientY };
  const touch = e.changedTouches[0] ?? e.touches[0];
  return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null;
};

/**
 * Walk the elementsFromPoint stack and return the topmost `.react-flow__node`
 * wrapper under the cursor (or null if none). Used for body-drop fallbacks
 * where React Flow's `connectionRadius` was too small to snap to a handle.
 */
const nodeElAtPoint = (clientX: number, clientY: number): Element | null => {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    const nodeEl = (el as HTMLElement).closest?.('.react-flow__node');
    if (nodeEl) return nodeEl;
  }
  return null;
};

/**
 * Imperatively flash a handle's `data-invalid-flash` attribute for ~250ms so
 * a wrong-type drop (e.g. dragging a target endpoint onto a source-only
 * handle) gives the user a brief red feedback before the edge restores
 * (US-022). DOM-driven so the React tree doesn't have to know about each
 * handle's per-flash state.
 */
const FLASH_DURATION_MS = 250;
const flashInvalidHandle = (
  wrapper: HTMLElement | null,
  nodeId: string | null | undefined,
  handleId: string | null | undefined,
): void => {
  if (!wrapper || !nodeId || !handleId) return;
  const nodeEl = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  if (!nodeEl) return;
  const handleEl = nodeEl.querySelector<HTMLElement>(
    `.react-flow__handle[data-handleid="${CSS.escape(handleId)}"]`,
  );
  if (!handleEl) return;
  handleEl.setAttribute('data-invalid-flash', 'true');
  window.setTimeout(() => {
    handleEl.removeAttribute('data-invalid-flash');
  }, FLASH_DURATION_MS);
};

const mergeNodeOverride = (node: DemoNode, override: Partial<DemoNode> | undefined): DemoNode => {
  if (!override) return node;
  // The override is keyed by the node's id, so its `data` (when present) is
  // always a partial of the SAME variant as node.data. TS can't see this
  // through the discriminated union spread, so cast at the boundary.
  const data = override.data ? { ...node.data, ...override.data } : node.data;
  return { ...node, ...override, data } as DemoNode;
};

const mergeConnectorOverride = (
  conn: Connector,
  override: Partial<Connector> | undefined,
): Connector => {
  if (!override) return conn;
  // Style-tab edits never change kind, so the discriminator stays intact and
  // the cast is safe at runtime (TS can't see through the union spread).
  return { ...conn, ...override } as Connector;
};

const nodeTypes = {
  playNode: PlayNode,
  stateNode: StateNode,
  shapeNode: ShapeNode,
  imageNode: ImageNode,
  iconNode: IconNode,
  // US-011: container node grouping other nodes via `parentId`. React Flow
  // positions children relative to the group; dragging the group moves the
  // group + every child together.
  group: GroupNode,
};
const edgeTypes = { editableEdge: EditableEdge };

// US-010: edges render at zIndex 1 so they paint above sibling nodes but
// below the group-label slot (zIndex 2 in CSS, see US-011+). Defined as a
// module-level constant — passing an inline object literal to ReactFlow's
// defaultEdgeOptions would change identity every render and force xyflow's
// edge merging to recompute.
const DEFAULT_EDGE_OPTIONS = { zIndex: 1 };

// US-009: smoothstep corner radius — kept in sync with EditableEdge so the
// reconnect-time connection line traces the same zigzag profile as the
// committed edge.
const SMOOTHSTEP_BORDER_RADIUS = 8;

/**
 * US-009: custom connection-line component used while a reconnect drag is in
 * flight. xyflow unmounts the original edge for the duration of the gesture
 * (see EdgeWrapper: `!reconnecting && <EdgeComponent />`) and substitutes a
 * default thin grey bezier — visually disconnected from the edge being
 * modified. We mark the user-selected reconnectable edge with `reconnectable:
 * true` (in `rfEdges`), so during a reconnect drag it's the unique edge with
 * that flag. We mirror the edge's `style` (stroke color / width / dasharray)
 * and `data.path` (curve vs zigzag) onto the in-flight line so the drag looks
 * like the original edge sliding to follow the cursor.
 *
 * For NEW connection drags (onConnect, not onReconnect) the edge being
 * "reconnected" is null even when an unrelated edge happens to be selected:
 * we gate on a ref that's set in onReconnectStart and cleared in
 * onReconnectEnd, so a new-connection drag retains xyflow's default styling.
 */
const buildReconnectAwareConnectionLine = (isReconnectingRef: {
  current: boolean;
}): ComponentType<ConnectionLineComponentProps> => {
  return function ReconnectAwareConnectionLine({
    fromX,
    fromY,
    toX,
    toY,
    fromPosition,
    toPosition,
    connectionLineStyle,
  }: ConnectionLineComponentProps) {
    // useStore subscribes the line to edge mutations so style edits to the
    // selected edge mid-drag (theoretical, not currently exposed) propagate.
    // The ref guard makes a new-connection drag fall through to the default
    // styling even when an unrelated edge is selected and `reconnectable: true`
    // — only a real reconnect gesture inherits the edge's style.
    const reconnectingEdge = useStore((s) =>
      isReconnectingRef.current ? (s.edges.find((e) => e.reconnectable === true) ?? null) : null,
    );
    const data = reconnectingEdge?.data as EditableEdgeData | undefined;
    const isStep = data?.path === 'step';
    const [path] = isStep
      ? getSmoothStepPath({
          sourceX: fromX,
          sourceY: fromY,
          sourcePosition: fromPosition,
          targetX: toX,
          targetY: toY,
          targetPosition: toPosition,
          borderRadius: SMOOTHSTEP_BORDER_RADIUS,
        })
      : getBezierPath({
          sourceX: fromX,
          sourceY: fromY,
          sourcePosition: fromPosition,
          targetX: toX,
          targetY: toY,
          targetPosition: toPosition,
        });
    const style = reconnectingEdge?.style ?? connectionLineStyle ?? undefined;
    return <path d={path} fill="none" className="react-flow__connection-path" style={style} />;
  };
};

/**
 * US-006: bridge for ESC cancellation of in-flight connection drags. xyflow
 * exposes `cancelConnection` only via the internal store, which is reachable
 * through `useStoreApi` — and that hook only resolves inside
 * `<ReactFlowProvider>`. Rendering this tiny child as a `<ReactFlow>`
 * descendant lets the outer component grab the store handle through a ref
 * without restructuring the wrapper.
 */
type StoreApi = ReturnType<typeof useStoreApi>;
function StoreApiBridge({ storeApiRef }: { storeApiRef: { current: StoreApi | null } }) {
  const storeApi = useStoreApi();
  useEffect(() => {
    storeApiRef.current = storeApi;
    return () => {
      if (storeApiRef.current === storeApi) storeApiRef.current = null;
    };
  }, [storeApi, storeApiRef]);
  return null;
}

/**
 * True when the element is a form control or contentEditable surface — used to
 * skip canvas-level keyboard handlers while focus is in an editor (InlineEdit,
 * detail-panel inputs, etc.). Lives here so the canvas's ESC priority chain
 * can defer to InlineEdit's own ESC handler (priority 1: inline edit cancels
 * before drag-create / connection / selection).
 */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const isEditableTarget = (el: Element | null): boolean => {
  if (!el) return false;
  if (EDITABLE_TAGS.has(el.tagName)) return true;
  return el instanceof HTMLElement && el.isContentEditable;
};

const statusFor = (runs: NodeRuns | undefined, id: string): NodeStatus =>
  runs?.[id]?.status ?? 'idle';

/**
 * Per-node `status` injected into a node's `data` slot. PlayNode (US-030)
 * needs to distinguish "never run" (undefined → hide pill) from "ran-then-idle"
 * (the runs reducer doesn't actually produce idle entries — the only way
 * status is undefined is no-entry-in-map). StateNode falls back to 'idle' on
 * its own; passing undefined upstream lets PlayNode see the difference
 * without affecting StateNode.
 */
const dataStatusFor = (runs: NodeRuns | undefined, id: string): NodeStatus | undefined =>
  runs?.[id]?.status;

/**
 * Per-node error message injected into a node's `data` slot when the most
 * recent run failed. PlayNode (US-018) surfaces it as the play-button
 * tooltip in place of the removed status chip.
 */
const dataErrorMessageFor = (runs: NodeRuns | undefined, id: string): string | undefined =>
  runs?.[id]?.status === 'error' ? runs[id]?.error : undefined;

/**
 * Promise-wrapped FileReader → base64 data: URL. Injected into
 * `handleCanvasDrop` so the orchestration stays testable (tests pass a
 * deterministic stub instead of constructing a real FileReader).
 */
const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('FileReader did not produce a string'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(file);
  });

export function DemoCanvas({
  nodes,
  connectors,
  selectedNodeIds,
  selectedConnectorIds,
  onSelectionChange,
  runs,
  onPlayNode,
  nodeOverrides,
  connectorOverrides,
  onNodePositionChange,
  onNodePositionsChange,
  onNodeResize,
  onNodeLabelChange,
  onNodeDescriptionChange,
  onConnectorLabelChange,
  onCreateShapeNode,
  onCreateConnector,
  onReconnectConnector,
  onReorderNode,
  onDeleteNode,
  onCopyNode,
  onPasteAt,
  hasClipboard,
  selectedNodes,
  selectedConnectors,
  onStyleNode,
  onStyleNodePreview,
  onStyleNodes,
  onStyleNodesPreview,
  onStyleConnector,
  onStyleConnectorPreview,
  onRfInit,
  onTidy,
  onNodeClick,
  onConnectorClick,
  onPaneClick,
  onCreateAndConnectFromPane,
  pendingEditNodeId,
  onCreateImageNode,
  onIngestImageUrl,
  onExportSvg,
  onExportPdf,
  iconPickerOpen,
  onOpenIconPicker,
  onCloseIconPicker,
  onPickIcon,
  onRequestIconReplace,
  onPinEndpoint,
  onUnpinEndpoint,
  onGroupNodes,
  onUngroupSelection,
}: DemoCanvasProps) {
  // Bottom-toolbar draw mode (US-028). When `drawShape` is set, the wrapper
  // shows a crosshair cursor and a pointer-down on the React Flow pane begins
  // an Excalidraw-style drag. We track the start + current pointer position in
  // CLIENT coordinates and only convert to flow coordinates at commit time
  // (mouse-up); the ghost preview overlay renders relative to the wrapper's
  // bounding rect, so it stays accurate even if the canvas pans during the
  // gesture (the underlying flow conversion handles the transform).
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  // US-006: handle to the React Flow store (registered by <StoreApiBridge>).
  // Used to call `cancelConnection` when ESC cancels an in-flight connection.
  const storeApiRef = useRef<StoreApi | null>(null);
  const [drawShape, setDrawShape] = useState<ShapeKind | null>(null);
  // US-010: paste an image from the clipboard onto the canvas. Listens at the
  // document level (paste events bubble there regardless of focus) and skips
  // pastes that originate inside an editable target — InlineEdit / form inputs
  // keep their native paste behaviour. The new imageNode is centered on the
  // wrapper's viewport center, translated to flow space via the React Flow
  // instance, then offset by half the default size so the node is visually
  // centered. The parent owns persistence + undo via `onCreateImageNode`.
  useEffect(() => {
    if (!onCreateImageNode) return;
    const handler = (e: ClipboardEvent) => {
      const target = e.target as Element | null;
      if (isEditableTarget(target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      let imageFile: File | null = null;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          imageFile = item.getAsFile();
          if (imageFile) break;
        }
      }
      if (!imageFile) return;
      const wrapper = wrapperRef.current;
      const rfInstance = rfInstanceRef.current;
      if (!wrapper || !rfInstance) return;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl !== 'string') return;
        const rect = wrapper.getBoundingClientRect();
        const center = rfInstance.screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
        onCreateImageNode(dataUrl, {
          x: center.x - IMAGE_DEFAULT_SIZE.width / 2,
          y: center.y - IMAGE_DEFAULT_SIZE.height / 2,
        });
      };
      reader.readAsDataURL(imageFile);
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [onCreateImageNode]);
  // US-011 / US-012 / US-023: drag-drop image ingestion. Listeners are
  // attached to the wrapper directly (drop events fire on the actual drop
  // target, unlike paste which bubbles to document). `dragover` is required
  // to call preventDefault so the browser permits the subsequent `drop`; we
  // gate that on a payload we know how to handle (Files for US-011,
  // text/uri-list or text/plain for US-012) so internal canvas drag gestures
  // (node drag, connector drag, draw-shape drag) keep their default behaviour.
  //
  // Orchestration lives in @/lib/canvas-drop so the test suite can pin the
  // behaviour without a DOM. US-023 extracted it after a regression-report
  // that turned out to be non-reproducible — the unit tests now make sure a
  // future marquee/perf refactor can't silently break the drop path.
  useEffect(() => {
    if (!onCreateImageNode && !onIngestImageUrl) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const gates = { file: !!onCreateImageNode, url: !!onIngestImageUrl };
    const onDragOver = (e: DragEvent) => {
      if (!isCandidateImageDrag(e.dataTransfer?.types, gates)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      const rfInstance = rfInstanceRef.current;
      if (!rfInstance) return;
      void handleCanvasDrop(e, {
        onCreateImageNode,
        onIngestImageUrl,
        screenToFlowPosition: rfInstance.screenToFlowPosition,
        imageDefaultSize: IMAGE_DEFAULT_SIZE,
        readFileAsDataUrl: readFileAsDataUrl,
      });
    };
    wrapper.addEventListener('dragover', onDragOver);
    wrapper.addEventListener('drop', onDrop);
    return () => {
      wrapper.removeEventListener('dragover', onDragOver);
      wrapper.removeEventListener('drop', onDrop);
    };
  }, [onCreateImageNode, onIngestImageUrl]);
  // Mid-connect (or mid-reconnect) flag drives a wrapper class so handles on
  // every node stay visible until the gesture releases — the source has
  // US-018: per-edge imperative handle map. Each EditableEdge registers its
  // `enter inline-edit` callback on mount; demo-canvas calls the registered
  // handle from onEdgeDoubleClick so a double-click anywhere on the edge body
  // (not just the label button) opens the inline editor. Map (not React
  // state) so registering/unregistering doesn't churn re-renders.
  const editHandlesRef = useRef<Map<string, () => void>>(new Map());
  const registerEditHandle = useCallback((id: string, enter: () => void) => {
    editHandlesRef.current.set(id, enter);
    return () => {
      const current = editHandlesRef.current.get(id);
      // Only delete if it's the same handle — guards against stale unregisters
      // racing a remount.
      if (current === enter) editHandlesRef.current.delete(id);
    };
  }, []);

  // already left hover and the user needs to discover drop targets without
  // hover-then-aim. Toggled via onConnectStart/End + onReconnectStart/End.
  const [connecting, setConnecting] = useState(false);
  // Mirror `connecting` into a ref so the global ESC handler (single window
  // listener) reads the live value without re-binding on every render.
  const connectingRef = useRef(false);
  useEffect(() => {
    connectingRef.current = connecting;
  }, [connecting]);
  // US-006: ESC during a connection/reconnect drag flips these flags so the
  // body-drop fallback inside onConnectEndCb / onReconnectEndCb early-exits
  // without persisting a connector. The synthesized mouseup we dispatch to
  // end xyflow's document-level pointer listeners would otherwise fall
  // through to the body-drop hit-test and create a stray edge.
  const connectCancelledRef = useRef(false);
  const reconnectCancelledRef = useRef(false);
  // US-009: true while a RECONNECT drag is in flight (set in onReconnectStart,
  // cleared in onReconnectEnd). Read by the custom connection-line component
  // so a NEW-connection drag (onConnectStart) doesn't accidentally inherit the
  // styling of an unrelated selected edge — only a real reconnect gesture does.
  const isReconnectingRef = useRef(false);
  // US-015: drop-on-pane popover state. Set in onConnectEndCb when a new
  // connection drag releases over empty canvas (not on a node body, not on a
  // handle). The popover anchors at the cursor's screen position and offers
  // the canvas-toolbar's shape set; picking one fans out to the parent's
  // create-and-connect callback. Null when no popover is open.
  const [dropPopover, setDropPopover] = useState<{
    /** Cursor screen position the popover anchors to (client px). */
    clientX: number;
    clientY: number;
    /** Drop position in flow space — feeds the new node's position. */
    flowX: number;
    flowY: number;
    /** Source node id for the connector wired into the new node. */
    sourceNodeId: string;
  } | null>(null);
  // US-013/015 (icon picker): the state slice + pick handlers live in demo-view
  // so the detail panel's "Change icon…" button (US-015) and the iconNode
  // double-click (US-016) can dispatch openIconPicker('replace', nodeId)
  // without going through this component. demo-canvas is a transparent
  // pass-through for the toolbar's controlled-open chrome only.
  // Mirror into a ref so cross-handler closures (ESC chain, viewport-change
  // dismissal) read the live value without re-binding.
  const dropPopoverRef = useRef<typeof dropPopover>(null);
  useEffect(() => {
    dropPopoverRef.current = dropPopover;
  }, [dropPopover]);
  const closeDropPopover = useCallback(() => {
    setDropPopover(null);
  }, []);
  // US-009: memoize the connection-line component so React Flow doesn't see a
  // new identity each render and remount the line mid-drag. The component
  // closes over `isReconnectingRef`; the ref itself is stable across renders.
  const connectionLineComponent = useMemo(
    () => buildReconnectAwareConnectionLine(isReconnectingRef),
    [],
  );
  // US-017: imperative DOM markers driven by pointermove tracking during a
  // connection / reconnect drag. `data-connect-source` is set on the source
  // node so its outlets stay visible (other nodes' outlets are hidden via
  // CSS). `data-connect-target` is set on whichever node is currently under
  // the cursor (excluding the source) so the candidate-target highlight
  // tracks the user's aim. Both are cleared in `clearConnectMarkers` on
  // gesture end (drop/cancel). Refs back the markers so the cleanup function
  // doesn't have to re-walk every node element.
  const connectSourceNodeIdRef = useRef<string | null>(null);
  const connectTargetNodeIdRef = useRef<string | null>(null);
  const setConnectSource = useCallback((nodeId: string | null) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      connectSourceNodeIdRef.current = nodeId;
      return;
    }
    const prev = connectSourceNodeIdRef.current;
    if (prev && prev !== nodeId) {
      const prevEl = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(prev)}"]`);
      prevEl?.removeAttribute('data-connect-source');
    }
    if (nodeId) {
      const el = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
      el?.setAttribute('data-connect-source', 'true');
    }
    connectSourceNodeIdRef.current = nodeId;
  }, []);
  const setConnectTarget = useCallback((nodeId: string | null) => {
    const wrapper = wrapperRef.current;
    const prev = connectTargetNodeIdRef.current;
    if (prev === nodeId) return;
    if (wrapper && prev) {
      const prevEl = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(prev)}"]`);
      prevEl?.removeAttribute('data-connect-target');
    }
    if (wrapper && nodeId) {
      const el = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
      el?.setAttribute('data-connect-target', 'true');
    }
    connectTargetNodeIdRef.current = nodeId;
  }, []);
  const clearConnectMarkers = useCallback(() => {
    setConnectSource(null);
    setConnectTarget(null);
  }, [setConnectSource, setConnectTarget]);
  // Track the cursor's hovered node while a connect or reconnect drag is in
  // flight. xyflow's connection line is owned by document-level pointer
  // listeners inside `@xyflow/system` XYHandle, so we ride the same channel
  // (pointermove on document) to stay in sync without fighting React Flow
  // for ownership of the gesture. Listener mounts only while `connecting`
  // is true and unmounts on end / cancel — no idle-time cost.
  useEffect(() => {
    if (!connecting) {
      setConnectTarget(null);
      return;
    }
    const onMove = (e: globalThis.PointerEvent) => {
      const nodeEl = nodeElAtPoint(e.clientX, e.clientY);
      const id = nodeEl?.getAttribute('data-id') ?? null;
      // The source node should not also be highlighted as a target — dropping
      // back on the source is rejected by both onConnect (same-node guard at
      // demo-canvas:1241) and the body-drop fallback (lines 1307, 1452, 1465),
      // so showing it as a candidate would mislead the user.
      if (id && id === connectSourceNodeIdRef.current) {
        setConnectTarget(null);
        return;
      }
      setConnectTarget(id);
    };
    document.addEventListener('pointermove', onMove);
    return () => {
      document.removeEventListener('pointermove', onMove);
    };
  }, [connecting, setConnectTarget]);
  // State drives the ghost preview render; refs back the handlers so a single
  // synchronous gesture (pointerdown→move→up in one task) reads up-to-date
  // values without waiting for a React re-render to refresh useCallback
  // closures.
  //
  // Coordinates are stored in CLIENT space (window-relative) — converting
  // to wrapper-local at down-time and back at up-time would drift if the
  // wrapper moves between events (e.g. error banner appears, header expands,
  // etc.). Ghost render uses the current wrapper rect to compute local
  // offsets just for paint.
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const drawShapeRef = useRef<ShapeKind | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const drawCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const drawingRef = useRef(false);

  // Mirror drawShape state into a ref so handlers see the live value without
  // depending on closure identity (handler refs need to stay stable so React
  // event delegation keeps working across renders mid-gesture).
  useEffect(() => {
    drawShapeRef.current = drawShape;
  }, [drawShape]);

  const exitDrawMode = useCallback(() => {
    setDrawShape(null);
    setDrawStart(null);
    setDrawCurrent(null);
    drawShapeRef.current = null;
    drawStartRef.current = null;
    drawCurrentRef.current = null;
    drawingRef.current = false;
  }, []);

  // US-006: ESC priority chain. A single window-level keydown listener handles
  // all in-progress cancellations in most-specific-first order, with early
  // returns so a single keypress triggers exactly one cancellation.
  //
  //   1. Inline label edit — handled by InlineEdit's own onKeyDown (cancel +
  //      stopPropagation). We additionally bail when focus is in an editable
  //      element so a future inline editor that forgets stopPropagation still
  //      gets the right behaviour.
  //   2. Drag-create (toolbar shape placement) — exit draw mode, no node added.
  //   3. Connection drag (mid edge-draw, before drop) — flag the cancel so
  //      the body-drop fallback in onConnectEndCb is skipped, then dispatch a
  //      synthetic mouseup so xyflow's document-level pointer listeners stop
  //      tracking the gesture.
  //   4. Selection — clear node + connector selections.
  //
  // (Marquee cancellation was removed in US-022 — the marquee gesture is no
  //  longer wired; primary-mouse drag on empty canvas is a no-op.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 1. Inline label edit — defer to InlineEdit's own handler.
      if (isEditableTarget(document.activeElement)) return;
      // 2. Drag-create.
      if (drawShapeRef.current) {
        e.preventDefault();
        exitDrawMode();
        return;
      }
      // 3. Connection drag (or reconnect).
      if (connectingRef.current) {
        e.preventDefault();
        connectCancelledRef.current = true;
        reconnectCancelledRef.current = true;
        // Clear xyflow's connection-store immediately so the in-flight
        // connection line stops rendering, and end the gesture by
        // synthesizing a mouseup on document — xyflow's onPointerUp inside
        // XYHandle is bound to document, so this is what unwinds its
        // closure listeners. Coords default to (0,0); the cancel flag
        // makes onConnectEndCb early-exit before any hit-test.
        try {
          storeApiRef.current?.getState().cancelConnection();
        } catch {
          // store may not be available (test harness without provider) — fall
          // through to mouseup dispatch which still ends the gesture.
        }
        document.dispatchEvent(
          new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }),
        );
        setConnecting(false);
        return;
      }
      // 3a. US-015: drop-on-pane popover. Closing here (rather than relying
      //     solely on Radix's onEscapeKeyDown) handles the case where focus is
      //     still on the canvas after the drag — Radix only intercepts ESC
      //     when focus is inside the popover content.
      if (dropPopoverRef.current) {
        e.preventDefault();
        setDropPopover(null);
        return;
      }
      // 4. Selection clear.
      const hadNodeSel = selectedIdSetRef.current.size > 0;
      const hadConnSel = selectedConnIdSetRef.current.size > 0;
      if (hadNodeSel || hadConnSel) {
        e.preventDefault();
        onSelectionChangeRef.current?.([], []);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exitDrawMode]);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!drawShapeRef.current) return;
    const target = e.target as HTMLElement | null;
    if (!target?.classList.contains('react-flow__pane')) return;
    const client = { x: e.clientX, y: e.clientY };
    drawingRef.current = true;
    drawStartRef.current = client;
    drawCurrentRef.current = client;
    setDrawStart(client);
    setDrawCurrent(client);
    // Capture the pointer so move/up land here even if the cursor leaves
    // the React Flow pane (e.g. drags up onto the toolbar). Wrapped because
    // setPointerCapture throws on synthetic (non-trusted) events used in tests.
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore — gesture still works without explicit capture
    }
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return;
    const client = { x: e.clientX, y: e.clientY };
    drawCurrentRef.current = client;
    setDrawCurrent(client);
  }, []);

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {
        // capture may not have been granted (synthetic events, browsers
        // without pointer capture support); ignore.
      }
      const start = drawStartRef.current;
      const current = drawCurrentRef.current;
      const shape = drawShapeRef.current;
      const rfInstance = rfInstanceRef.current;
      // Always exit draw mode after a gesture, even if the commit short-circuits
      // (too small, missing references). The PRD spec: "After commit (or ESC),
      // draw mode exits automatically and the cursor returns to default."
      exitDrawMode();
      if (!start || !current || !shape || !rfInstance) return;
      const minX = Math.min(start.x, current.x);
      const minY = Math.min(start.y, current.y);
      const maxX = Math.max(start.x, current.x);
      const maxY = Math.max(start.y, current.y);
      const dragScreenWidth = maxX - minX;
      const dragScreenHeight = maxY - minY;
      // US-010: convert both corners through screenToFlowPosition so the
      // committed width/height are in FLOW units. The ghost preview is drawn
      // in client px (`canvas-draw-ghost`), and React Flow renders the node
      // at `width × zoom` client px — passing the raw screen-px drag would
      // make the placed node visually larger (or smaller) than the ghost
      // whenever zoom ≠ 1. With both corners projected, the committed
      // logical size is exactly the ghost's screen extent ÷ zoom, so the
      // result paints at the same client-pixel size as the ghost. This is
      // the standard React Flow drag-create pattern (RF docs:
      // https://reactflow.dev/examples/interaction/drag-and-drop).
      const flowMin = rfInstance.screenToFlowPosition({ x: minX, y: minY });
      const flowMax = rfInstance.screenToFlowPosition({ x: maxX, y: maxY });
      const dragFlowWidth = flowMax.x - flowMin.x;
      const dragFlowHeight = flowMax.y - flowMin.y;
      // MIN_DRAW_SIZE stays in screen pixels — it's a UX threshold for
      // distinguishing "intentional drag" from "accidental click", which the
      // user perceives in screen-space, not flow-space. Below the threshold
      // on either axis we fall back to SHAPE_DEFAULT_SIZE (already in flow
      // units) so single-clicks still produce a usable node.
      const tooSmall = dragScreenWidth < MIN_DRAW_SIZE || dragScreenHeight < MIN_DRAW_SIZE;
      const width = tooSmall ? SHAPE_DEFAULT_SIZE[shape].width : dragFlowWidth;
      const height = tooSmall ? SHAPE_DEFAULT_SIZE[shape].height : dragFlowHeight;
      onCreateShapeNode?.(shape, flowMin, { width, height });
    },
    [exitDrawMode, onCreateShapeNode],
  );
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

  // Right-click context menu state. Radix's <ContextMenu.Root> is event-driven
  // (its <Trigger> opens the menu on its own contextmenu event) and has no
  // controlled `open` prop. To open the menu at the cursor position from
  // React Flow's onNodeContextMenu — which runs BEFORE the trigger's listener
  // would fire (and we preventDefault to suppress browser's default menu) —
  // we render an invisible 0×0 trigger element pinned to the cursor and
  // dispatch a synthetic contextmenu event on it. The same trigger ref is
  // re-positioned for every right-click; one ContextMenu instance handles
  // every node. The menu items read `contextNodeIdRef` so callbacks dispatch
  // to the right node even if state hasn't re-rendered yet.
  const contextEnabled =
    !!onReorderNode ||
    !!onDeleteNode ||
    !!onCopyNode ||
    !!onPasteAt ||
    !!onUnpinEndpoint ||
    !!onGroupNodes;
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  // Whether the most recent right-click landed on a node (true) vs. the empty
  // pane (false). Used to gate per-node items (Copy / reorder / Delete) which
  // don't make sense for an empty-canvas right-click. State (not just a ref)
  // because the menu's children are read on render — and the menu re-renders
  // when contextMenuPos changes, so this stays in sync via the same setState
  // pair below.
  const [contextOnNode, setContextOnNode] = useState(false);
  // US-003: track the right-clicked node's type so icon-node-specific items
  // (currently just 'Change icon') render only when the cursor landed on an
  // iconNode. Cleared whenever the menu closes or the right-click hit the pane.
  const [contextNodeType, setContextNodeType] = useState<string | null>(null);
  // US-007: track an endpoint right-click so the menu shows an "Unpin" item
  // tied to a specific connector + endpoint. `pinned` mirrors the dot's data-
  // attribute at the moment of right-click so the item is only visible for
  // already-pinned endpoints (the only ones where "Unpin" is meaningful).
  const [contextEndpoint, setContextEndpoint] = useState<{
    connectorId: string;
    kind: 'source' | 'target';
    pinned: boolean;
  } | null>(null);
  const contextNodeIdRef = useRef<string | null>(null);
  const contextTriggerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!contextMenuPos) return;
    const trigger = contextTriggerRef.current;
    if (!trigger) return;
    // Dispatch a synthetic contextmenu event so Radix's Trigger opens at the
    // cursor. The Trigger reads clientX/clientY off the event for positioning.
    const evt = new MouseEvent('contextmenu', {
      clientX: contextMenuPos.x,
      clientY: contextMenuPos.y,
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
    });
    trigger.dispatchEvent(evt);
  }, [contextMenuPos]);

  const handleReorderPick = useCallback(
    (op: ReorderOp) => {
      const id = contextNodeIdRef.current;
      if (!id || !onReorderNode) return;
      onReorderNode(id, op);
    },
    [onReorderNode],
  );

  const handleDeletePick = useCallback(() => {
    const id = contextNodeIdRef.current;
    if (!id || !onDeleteNode) return;
    onDeleteNode(id);
  }, [onDeleteNode]);

  const handleCopyPick = useCallback(() => {
    const id = contextNodeIdRef.current;
    if (!id || !onCopyNode) return;
    onCopyNode(id);
  }, [onCopyNode]);

  // US-003: dispatch the icon-replace flow (same path as US-016 dblclick and
  // US-022 StyleStrip button) so the picker opens for the right-clicked node
  // and a single undo entry is pushed when an icon is selected.
  const handleChangeIconPick = useCallback(() => {
    const id = contextNodeIdRef.current;
    if (!id || !onRequestIconReplace) return;
    onRequestIconReplace(id);
  }, [onRequestIconReplace]);

  // US-012: forward the current selection to the parent's groupNodes op.
  // The parent re-filters via selectGroupableSet so the menu's eligibility
  // check (also via selectGroupableSet, below) and the actual op see the
  // same set even if state shifted between menu-open and click. Reads from
  // the props array (controlled selection) — it's the same set xyflow
  // sees and what's already gated the menu's visibility.
  const handleGroupPick = useCallback(() => {
    if (!onGroupNodes) return;
    onGroupNodes([...selectedNodeIds]);
  }, [onGroupNodes, selectedNodeIds]);

  // US-013: forward the current selection to the parent's ungroup op. The
  // parent re-filters via `selectUngroupableSet` (same filter the menu's
  // eligibility check uses, below), so a selection that mixes groups with
  // free nodes still produces a clean batch of just the groups.
  const handleUngroupPick = useCallback(() => {
    if (!onUngroupSelection) return;
    onUngroupSelection([...selectedNodeIds]);
  }, [onUngroupSelection, selectedNodeIds]);

  // US-007: right-click on a visible endpoint dot opens the canvas's
  // context menu in "endpoint mode". The dot calls into this from its own
  // onContextMenu, which we route through edge.data so editable-edge can
  // stay free of canvas state. `pinned` is captured at right-click time so
  // the Unpin item only shows for already-pinned endpoints.
  const handleEndpointContextMenu = useCallback(
    (
      connId: string,
      kind: 'source' | 'target',
      pinned: boolean,
      clientX: number,
      clientY: number,
    ) => {
      contextNodeIdRef.current = null;
      setContextOnNode(false);
      setContextNodeType(null);
      setContextEndpoint({ connectorId: connId, kind, pinned });
      setContextMenuPos({ x: clientX, y: clientY });
    },
    [],
  );

  // US-007: invoke onUnpinEndpoint with the captured endpoint. Same one-undo-
  // entry contract as the pin path (parent owns the undo push).
  const handleUnpinPick = useCallback(() => {
    const ep = contextEndpoint;
    if (!ep || !onUnpinEndpoint) return;
    onUnpinEndpoint(ep.connectorId, ep.kind);
  }, [contextEndpoint, onUnpinEndpoint]);

  const handlePastePick = useCallback(() => {
    if (!onPasteAt) return;
    const pos = contextMenuPos;
    const rfInstance = rfInstanceRef.current;
    if (!pos || !rfInstance) return;
    // Convert the right-click's client coords to flow space so the parent
    // anchors the pasted node(s) at the cursor regardless of pan/zoom.
    const flowPos = rfInstance.screenToFlowPosition({ x: pos.x, y: pos.y });
    onPasteAt(flowPos);
  }, [contextMenuPos, onPasteAt]);

  // Show ⌘ on macOS, Ctrl elsewhere. Read once per render (cheap) — Radix
  // re-mounts the menu on every open so the value is captured at the right
  // moment. navigator may be undefined in non-browser contexts (SSR), but
  // this component is purely client-side so the access is safe.
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  const copyShortcut = isMac ? '⌘C' : 'Ctrl+C';
  const pasteShortcut = isMac ? '⌘V' : 'Ctrl+V';

  // Set lookups for the controlled selection. React Flow's internal selection
  // is mirrored back via onSelectionChange so the parent's arrays remain the
  // source of truth — sourceNodes/rfEdges are recomputed off these sets.
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  // US-012: how many of the currently-selected nodes are eligible to be
  // wrapped in a new group (i.e. not already parented, not a group node).
  // Drives the right-click menu's "Group" item visibility. Recomputed when
  // either the selection or the underlying nodes array changes; cheap (≤ N).
  const groupableCount = useMemo(
    () => selectGroupableSet(selectedNodeIds, nodes as GroupableNode[]).length,
    [selectedNodeIds, nodes],
  );
  // US-013: how many of the currently-selected nodes are groups (eligible
  // for the right-click "Ungroup" item). When ≥ 1, the menu hides "Group"
  // and shows "Ungroup" instead — the two items are mutually exclusive.
  const ungroupableCount = useMemo(
    () => selectUngroupableSet(selectedNodeIds, nodes as GroupableNode[]).length,
    [selectedNodeIds, nodes],
  );
  const selectedConnectorIdSet = useMemo(
    () => new Set(selectedConnectorIds),
    [selectedConnectorIds],
  );

  const sourceNodes = useMemo<Node[]>(() => {
    const buildNode = (merged: DemoNode): Node => {
      const node: Node = {
        id: merged.id,
        type: merged.type,
        position: merged.position,
        data: {
          ...merged.data,
          status: dataStatusFor(runs, merged.id),
          errorMessage: dataErrorMessageFor(runs, merged.id),
          onPlay: onPlayNode,
          onResize: onNodeResize,
          setResizing,
          onLabelChange: onNodeLabelChange,
          onDescriptionChange:
            merged.type === 'shapeNode' || merged.type === 'imageNode' || merged.type === 'iconNode'
              ? undefined
              : onNodeDescriptionChange,
          // US-015: inject autoEditOnMount on the freshly drop-popover-created
          // node so it opens in label-edit mode. The flag is consumed once at
          // mount by the node component (lazy useState initializer); leaving
          // it set on later renders is harmless.
          autoEditOnMount: pendingEditNodeId === merged.id ? true : undefined,
        },
        selected: selectedNodeIdSet.has(merged.id),
      };
      // Pass explicit width/height to the React Flow node wrapper when set
      // in data. NodeResizer dispatches dimension changes that update these
      // during a gesture; we only persist (and hence sync them back into
      // data) on resize-stop.
      if (merged.data.width !== undefined) node.width = merged.data.width;
      if (merged.data.height !== undefined) node.height = merged.data.height;
      // US-011: forward `parentId` so React Flow positions this node relative
      // to its container group and drags the parent + children together.
      if (merged.parentId !== undefined) node.parentId = merged.parentId;
      // US-025: only the selected node may originate a new connection. Setting
      // `connectable: false` on unselected nodes makes their Handles ignore
      // connection-start gestures (xyflow's per-node `connectable` overrides
      // the global `nodesConnectable`). Selected nodes leave the field
      // undefined so the global gate (read-only mode, drawShape) still
      // applies. Reconnect drops onto unselected nodes are unaffected —
      // xyflow's reconnect path snaps via the always-present `.source`/
      // `.target` DOM classes, not the Handle's `isConnectable` prop.
      if (!selectedNodeIdSet.has(merged.id)) node.connectable = false;
      return node;
    };
    const fromServer = nodes.map((n) => buildNode(mergeNodeOverride(n, nodeOverrides?.[n.id])));
    // Override-only entries represent optimistic/pending creations (US-007):
    // a shape node has been drawn locally and the override carries a full
    // DemoNode whose id is not yet on the server. Once the SSE echo of the
    // POST resolves, the entry shows up in `nodes` and `pruneAgainst` drops
    // the override (per US-021) — until then we render the candidate so the
    // node appears at the dragged size with no flicker from default→dragged.
    const serverIds = new Set(nodes.map((n) => n.id));
    const fromOverrides: Node[] = [];
    if (nodeOverrides) {
      for (const [id, partial] of Object.entries(nodeOverrides)) {
        if (serverIds.has(id)) continue;
        const cand = partial as Partial<DemoNode>;
        if (typeof cand.type !== 'string' || !cand.position || !cand.data) continue;
        fromOverrides.push(buildNode({ ...cand, id } as DemoNode));
      }
    }
    // US-012: enforce React Flow's parent-before-children array invariant. The
    // server's PATCH path appends new nodes to the end of `nodes[]`, so a
    // freshly-created group lands AFTER its children even though their
    // `parentId` already points at it — React Flow then renders children as
    // floating (position treated as absolute, not parent-relative) until the
    // next reorder. Hoist every referenced parent just ahead of its earliest
    // child here so the canvas stays correct between the create-group POST
    // and the reorder PATCH (and irrespective of whether the on-disk array
    // ever gets sorted). Cheap for our node counts and idempotent for arrays
    // that are already correctly ordered.
    let merged: Node[] = [...fromServer, ...fromOverrides];
    const referencedParentIds = new Set<string>();
    for (const n of merged) {
      if (n.parentId) referencedParentIds.add(n.parentId);
    }
    for (const parentId of referencedParentIds) {
      const parentIdx = merged.findIndex((n) => n.id === parentId);
      if (parentIdx < 0) continue;
      const earliestChildIdx = merged.findIndex((n) => n.parentId === parentId);
      if (earliestChildIdx >= 0 && parentIdx > earliestChildIdx) {
        const parentNode = merged[parentIdx];
        if (!parentNode) continue;
        merged = merged.filter((_, i) => i !== parentIdx);
        // After splicing the parent out, the earliest child's index has not
        // shifted (the parent was AFTER the child). Insert directly there.
        merged.splice(earliestChildIdx, 0, parentNode);
      }
    }
    return merged;
  }, [
    nodes,
    selectedNodeIdSet,
    runs,
    onPlayNode,
    onNodeResize,
    setResizing,
    nodeOverrides,
    onNodeLabelChange,
    onNodeDescriptionChange,
    pendingEditNodeId,
  ]);

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

  // Mirror rfNodes into a ref so onNodesChange can compute the post-change
  // selection without waiting for setState to commit. Also kept in sync
  // synchronously inside onNodesChange — xyflow can fire that handler twice
  // in one synchronous task (resetSelectedElements + getSelectionChanges at
  // marquee start) and the second call must operate on the first call's
  // result, not on the pre-commit ref value (US-005).
  useEffect(() => {
    rfNodesRef.current = rfNodes;
  }, [rfNodes]);

  // selectedNodeIds is the source of truth for the selection rings. React Flow
  // dispatches its own `select` changes during resize/drag (and sometimes on
  // dimension changes) that would briefly drop the ring. Mirror the prop into
  // a ref and re-pin selected:true on every change so the visual stays
  // anchored to the parent's selection state — no flicker mid-resize. We
  // skip re-pinning ids that the user explicitly toggled in this batch
  // (Shift/Cmd-click), so deselect-via-multi-key still works (US-019).
  const selectedIdSetRef = useRef<Set<string>>(selectedNodeIdSet);
  useEffect(() => {
    selectedIdSetRef.current = selectedNodeIdSet;
  }, [selectedNodeIdSet]);

  // Stable handle for the parent's selection callback — the closure inside
  // onNodesChange/onEdgesChange would otherwise capture stale arrays. Using a
  // ref means user-driven selection changes always read the LATEST callback
  // without retriggering the React Flow listener wiring.
  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  // Mirror connector-id state into a ref for the same reason as
  // selectedIdSetRef — the edge change handler reads the latest set without
  // re-binding.
  const selectedConnIdSetRef = useRef<Set<string>>(selectedConnectorIdSet);
  useEffect(() => {
    selectedConnIdSetRef.current = selectedConnectorIdSet;
  }, [selectedConnectorIdSet]);

  // rfNodes is also mirrored into a ref so the change handler can compute the
  // post-applyNodeChanges selection synchronously (the setRfNodes updater
  // function runs later and can't drive a side effect).
  const rfNodesRef = useRef<Node[]>([]);

  // US-010: marquee gesture state. While a marquee drag is in flight,
  // `marqueeActiveRef` flips true and the per-frame select changes accumulate
  // into the two id sets below. `onSelectionChange` is NOT called up to the
  // parent during the drag — only once at `onSelectionEnd`. The rfNodes
  // local state keeps applying the changes so the canvas still visually
  // reflects the live marquee (selection rings track the rubber-band) — but
  // the parent's controlled props (`selectedNodeIds` / `selectedConnectorIds`)
  // stay frozen, which is what eliminates the per-frame sourceNodes recompute
  // + buildNode churn that caused the flashing in earlier attempts.
  //
  // additiveBase{Node,Edge}IdsRef holds the pre-marquee selection when the
  // user holds Shift/Meta at marquee start. xyflow always dispatches
  // `resetSelectedElements` at the first pointermove past the click threshold,
  // so the additive base would normally get deselected mid-drag. We filter
  // those deselects for ids in the additive base so the existing selection is
  // preserved through the gesture (visible + final).
  const marqueeActiveRef = useRef(false);
  const marqueeSelectedNodeIdsRef = useRef<Set<string>>(new Set());
  const marqueeSelectedEdgeIdsRef = useRef<Set<string>>(new Set());
  const additiveBaseNodeIdsRef = useRef<Set<string>>(new Set());
  const additiveBaseEdgeIdsRef = useRef<Set<string>>(new Set());
  // US-010: tentative additive snapshot captured at pane pointer-down BEFORE
  // xyflow's resetSelectedElements runs (which lands in onPointerMove right
  // before onSelectionStart). Without this snapshot the prior selection is
  // already gone by the time onSelectionStart can read it. When the user holds
  // Shift/Meta/Ctrl at pointer-down on the pane, the snapshot becomes the
  // additive base; otherwise it's `{ shift: false }` and the marquee replaces.
  const tentativeAdditiveBaseRef = useRef<{
    shift: boolean;
    nodeIds: Set<string>;
    edgeIds: Set<string>;
  } | null>(null);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // US-010: during an additive (Shift/Meta) marquee, skip xyflow's reset-
    // deselect for ids in the additive base — they should stay selected
    // through the gesture so the user sees the existing selection preserved.
    // xyflow's `resetSelectedElements` runs in onPointerMove BEFORE
    // onSelectionStart, so the additive base lives in tentativeAdditiveBaseRef
    // until onSelectionStart copies it into additiveBaseNodeIdsRef.
    const activeAdditiveBase = marqueeActiveRef.current
      ? additiveBaseNodeIdsRef.current
      : tentativeAdditiveBaseRef.current?.shift
        ? tentativeAdditiveBaseRef.current.nodeIds
        : null;
    const filteredChanges =
      activeAdditiveBase && activeAdditiveBase.size > 0
        ? changes.filter((c) => {
            if (c.type !== 'select') return true;
            if (c.selected === false && activeAdditiveBase.has(c.id)) return false;
            return true;
          })
        : changes;
    const explicitlyToggled = new Set<string>();
    for (const c of filteredChanges) {
      if (c.type === 'select') explicitlyToggled.add(c.id);
    }
    // applyNodeChanges on the current snapshot. We feed the same result to
    // setRfNodes below so the rendered nodes match what we're propagating.
    const next = applyNodeChanges(filteredChanges, rfNodesRef.current);
    const pinned = selectedIdSetRef.current;
    // Resize/dimension changes can transiently drop the `selected` flag —
    // restore it for nodes in `pinned` that the user didn't explicitly toggle
    // (US-019). US-010: skip the repin logic during a marquee gesture —
    // `pinned` reflects the parent's (stale) controlled selection prop, but
    // the marquee is actively changing selection; re-pinning previously-
    // selected nodes would fight the user's new marquee selection.
    const repinned = marqueeActiveRef.current
      ? next
      : pinned.size === 0
        ? next
        : next.map((n) => {
            if (pinned.has(n.id) && !explicitlyToggled.has(n.id) && !n.selected) {
              return { ...n, selected: true };
            }
            return n;
          });
    rfNodesRef.current = repinned;
    setRfNodes(repinned);
    // Propagate user-driven selection changes up to the parent. Programmatic
    // prop updates bypass this — ReactFlow's StoreUpdater applies them
    // directly to the store without dispatching changes.
    if (explicitlyToggled.size === 0) return;
    // US-010: during marquee, accumulate into the local ref and SKIP the
    // parent callback so `selectedNodeIds` doesn't churn on every frame.
    // `onSelectionEnd` fires the cb once with the final set.
    if (marqueeActiveRef.current) {
      for (const c of filteredChanges) {
        if (c.type !== 'select') continue;
        if (c.selected) marqueeSelectedNodeIdsRef.current.add(c.id);
        else marqueeSelectedNodeIdsRef.current.delete(c.id);
      }
      return;
    }
    const cb = onSelectionChangeRef.current;
    if (!cb) return;
    const sel = repinned.filter((n) => n.selected).map((n) => n.id);
    const prev = selectedIdSetRef.current;
    const sameLen = prev.size === sel.length;
    const sameAll = sameLen && sel.every((id) => prev.has(id));
    if (sameAll) return;
    // US-025: sync the ref alongside the parent setState. xyflow's
    // `addSelectedEdges` / `addSelectedNodes` fire BOTH onEdgesChange and
    // onNodesChange synchronously when a click swaps selection across types
    // (e.g. node selected → click edge → edge selection + node deselection
    // dispatched in one task). The ref-syncing useEffect runs on commit, so
    // the second handler in the same task would otherwise read a stale set
    // and overwrite the first handler's cb result with empty data — a single
    // click would effectively clear both selections.
    selectedIdSetRef.current = new Set(sel);
    cb(sel, [...selectedConnIdSetRef.current]);
  }, []);

  // Edge changes — wired so user-driven edge selection (marquee, click,
  // multi-key toggle) propagates up the same way node selection does. Without
  // this, edges would be uncontrolled in the React Flow store and the
  // controlled `selected` flag from props could get out of sync.
  // rfEdges is declared further below; keep the latest reference in a ref so
  // this callback doesn't have to wait on the declaration order.
  const rfEdgesRef = useRef<Edge[]>([]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    // US-010: filter reset-deselects on the additive base — same reasoning as
    // onNodesChange above.
    const activeAdditiveBase = marqueeActiveRef.current
      ? additiveBaseEdgeIdsRef.current
      : tentativeAdditiveBaseRef.current?.shift
        ? tentativeAdditiveBaseRef.current.edgeIds
        : null;
    const filteredChanges =
      activeAdditiveBase && activeAdditiveBase.size > 0
        ? changes.filter((c) => {
            if (c.type !== 'select') return true;
            if (c.selected === false && activeAdditiveBase.has(c.id)) return false;
            return true;
          })
        : changes;
    const explicitlyToggled = new Set<string>();
    for (const c of filteredChanges) {
      if (c.type === 'select') explicitlyToggled.add(c.id);
    }
    if (explicitlyToggled.size === 0) return;
    // US-010: same accumulator pattern as onNodesChange — during marquee,
    // collect the explicit toggles into the local ref and bail before firing
    // the parent callback.
    if (marqueeActiveRef.current) {
      for (const c of filteredChanges) {
        if (c.type !== 'select') continue;
        if (c.selected) marqueeSelectedEdgeIdsRef.current.add(c.id);
        else marqueeSelectedEdgeIdsRef.current.delete(c.id);
      }
      return;
    }
    const cb = onSelectionChangeRef.current;
    if (!cb) return;
    const next = applyEdgeChanges(filteredChanges, rfEdgesRef.current);
    const sel = next.filter((e) => e.selected).map((e) => e.id);
    const prev = selectedConnIdSetRef.current;
    const sameLen = prev.size === sel.length;
    const sameAll = sameLen && sel.every((id) => prev.has(id));
    if (sameAll) return;
    // US-025: see onNodesChange — sync the ref so the paired onNodesChange
    // call later in the same task reads up-to-date connector selection.
    selectedConnIdSetRef.current = new Set(sel);
    cb([...selectedIdSetRef.current], sel);
  }, []);

  // US-010: marquee gesture lifecycle. xyflow fires onSelectionStart when a
  // primary-button drag begins on the empty pane (or when modifier-marquee is
  // dispatched). onSelectionEnd fires on pointer-up. We snapshot the current
  // controlled selection into the marquee accumulator at start, then layer in
  // each per-frame select-change while the drag runs (see onNodesChange /
  // onEdgesChange above). At end we apply the xyflow #5451 workaround and
  // call the parent's onSelectionChange exactly once with the final set.
  //
  // Shift/Meta held at start → additive marquee: the pre-existing selection is
  // captured into additiveBase{Node,Edge}IdsRef and the change filters above
  // shield those ids from xyflow's `resetSelectedElements()`.
  const onSelectionStartCb = useCallback((event: ReactMouseEvent) => {
    marqueeActiveRef.current = true;
    const tentative = tentativeAdditiveBaseRef.current;
    // Prefer the tentative (captured at pointer-down before xyflow's reset);
    // fall back to event modifiers in case the pointer-down handler missed.
    const additive = tentative?.shift ?? (event.shiftKey || event.metaKey || event.ctrlKey);
    additiveBaseNodeIdsRef.current = additive
      ? new Set(tentative?.nodeIds ?? selectedIdSetRef.current)
      : new Set();
    additiveBaseEdgeIdsRef.current = additive
      ? new Set(tentative?.edgeIds ?? selectedConnIdSetRef.current)
      : new Set();
    marqueeSelectedNodeIdsRef.current = new Set(additiveBaseNodeIdsRef.current);
    marqueeSelectedEdgeIdsRef.current = new Set(additiveBaseEdgeIdsRef.current);
  }, []);
  const onSelectionEndCb = useCallback(() => {
    marqueeActiveRef.current = false;
    tentativeAdditiveBaseRef.current = null;
    const cb = onSelectionChangeRef.current;
    if (!cb) return;
    const finalNodeIds = [...marqueeSelectedNodeIdsRef.current];
    const finalNodeIdSet = new Set(finalNodeIds);
    const finalEdgeIds = new Set(marqueeSelectedEdgeIdsRef.current);
    // xyflow #5451 workaround: when the marquee covers both endpoints of an
    // edge, xyflow only marks a single edge between any node pair — parallel
    // edges (same source/target) get dropped from the selection. Sweep the
    // edge list and force-add any whose endpoints are both in the final
    // node-id set.
    for (const edge of rfEdgesRef.current) {
      if (finalNodeIdSet.has(edge.source) && finalNodeIdSet.has(edge.target)) {
        finalEdgeIds.add(edge.id);
      }
    }
    const prevNodeIds = selectedIdSetRef.current;
    const prevEdgeIds = selectedConnIdSetRef.current;
    const sameNodeSet =
      prevNodeIds.size === finalNodeIdSet.size && finalNodeIds.every((id) => prevNodeIds.has(id));
    const sameEdgeSet =
      prevEdgeIds.size === finalEdgeIds.size &&
      [...finalEdgeIds].every((id) => prevEdgeIds.has(id));
    if (sameNodeSet && sameEdgeSet) return;
    selectedIdSetRef.current = new Set(finalNodeIds);
    selectedConnIdSetRef.current = new Set(finalEdgeIds);
    cb(finalNodeIds, [...finalEdgeIds]);
  }, []);

  // US-010: capture-phase pointer-down on the wrapper fires BEFORE xyflow's
  // own onPointerDownCapture on `.react-flow__pane`. We use this to stash a
  // tentative additive-base snapshot (the pre-marquee selection) and the
  // shift/meta key state. xyflow's `resetSelectedElements()` then fires
  // synchronously inside onPointerMove past the click threshold — by then our
  // change-filter (see onNodesChange / onEdgesChange) can shield the additive
  // base from being deselected. Without this, the additive base is gone by
  // the time onSelectionStart runs.
  const onWrapperPointerDownCapture = useCallback((e: PointerEvent<HTMLDivElement>) => {
    tentativeAdditiveBaseRef.current = null;
    if (drawShapeRef.current) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    // Only the pane itself is a marquee starting surface — handles, nodes,
    // edges, and the toolbar each have their own gestures.
    if (!target?.classList.contains('react-flow__pane')) return;
    tentativeAdditiveBaseRef.current = {
      shift: e.shiftKey || e.metaKey || e.ctrlKey,
      nodeIds: new Set(selectedIdSetRef.current),
      edgeIds: new Set(selectedConnIdSetRef.current),
    };
  }, []);

  // US-010: xyflow #2733 workaround. When ≥ 2 nodes are selected (or any
  // group node — placeholder for US-011+), a right-click on any of them
  // ought to open OUR Radix context menu so the user can act on the whole
  // selection. xyflow's onNodeContextMenu only fires for the single node
  // under the cursor (and clears multi-selection in the process). Wiring a
  // capture-phase listener on the wrapper lets us pre-empt the native menu
  // and open Radix BEFORE xyflow gets the event.
  const onWrapperContextMenuCapture = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    // Only intervene when there's a multi-selection. Single-node and pane
    // right-clicks still flow through xyflow's onNodeContextMenu /
    // onPaneContextMenu paths (which handle their own preventDefault).
    const sel = selectedIdSetRef.current;
    if (sel.size < 2) return;
    const target = e.target as HTMLElement | null;
    // The synthetic contextmenu event we dispatch into the Radix trigger (via
    // the contextMenuPos useEffect below) bubbles back through this listener
    // — bail on the trigger element so we don't re-enter and loop.
    if (target === contextTriggerRef.current) return;
    // Verify the right-click landed inside the canvas (not on a popover,
    // menu, etc. that escaped through a Radix portal). Endpoint dots have
    // their own right-click handler (US-007) — let those through too.
    if (target?.closest('.anydemo-connector-endpoint-dot')) return;
    e.preventDefault();
    e.stopPropagation();
    contextNodeIdRef.current = null;
    setContextOnNode(true);
    setContextNodeType(null);
    setContextEndpoint(null);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  }, []);

  const reconnectableEdges = !!onReconnectConnector;
  // Reconnect endpoint handles are only useful when EXACTLY one connector is
  // selected — multi-select disables endpoint-drag (drag would re-route just
  // one of the selection, which is confusing). Mirrors single-select behavior.
  const onlySelectedConnectorId =
    selectedConnectorIdSet.size === 1 ? [...selectedConnectorIdSet][0] : null;
  const rfEdges = useMemo<Edge[]>(() => {
    const decorate = (c: Connector): Edge => {
      const adjacentRunning =
        statusFor(runs, c.source) === 'running' || statusFor(runs, c.target) === 'running';
      const isSelected = selectedConnectorIdSet.has(c.id);
      const edge = connectorToEdge(c, adjacentRunning, isSelected);
      if (isSelected) edge.selected = true;
      // `reconnectable: true` enables the endpoint-drag gesture for the edge;
      // React Flow shows reconnect handles on hover. Wired only when the
      // parent provided an onReconnectConnector callback AND this edge is the
      // sole selected connector — multi-select disables reconnect to avoid
      // ambiguous gestures.
      const enableReconnect = reconnectableEdges && c.id === onlySelectedConnectorId;
      const next: Edge = enableReconnect ? { ...edge, reconnectable: true } : edge;
      // Inject the runtime label-change callback into edge.data — same
      // channel the custom node components use for `onPlay` / `onResize`.
      // US-024: also pass `reconnectable` so the edge component knows when
      // to render the visible portal endpoint dots. US-007: inject the
      // pin-drag persistence callback and the endpoint-right-click handler
      // so editable-edge can stay free of canvas state.
      return {
        ...next,
        data: {
          ...next.data,
          onLabelChange: onConnectorLabelChange,
          reconnectable: enableReconnect,
          onPinEndpoint,
          onEndpointContextMenu: handleEndpointContextMenu,
          // US-018: stable callback (useCallback with empty deps) so the
          // memoized edge cache key doesn't churn.
          registerEditHandle,
        },
      };
    };
    const serverIds = new Set(connectors.map((c) => c.id));
    const fromServer = connectors.map((c) =>
      decorate(mergeConnectorOverride(c, connectorOverrides?.[c.id])),
    );
    // Override-only entries represent optimistic/pending creations (US-029):
    // the parent has set a full-Connector override BEFORE the POST round-trip
    // completes. Once the server echo arrives, the entry is also in
    // `connectors` and the prune drops the override (per US-021).
    const fromOverrides: Edge[] = [];
    if (connectorOverrides) {
      for (const [id, partial] of Object.entries(connectorOverrides)) {
        if (serverIds.has(id)) continue;
        const candidate = partial as Partial<Connector>;
        if (
          typeof candidate.source !== 'string' ||
          typeof candidate.target !== 'string' ||
          typeof candidate.kind !== 'string'
        ) {
          continue;
        }
        fromOverrides.push(decorate({ ...candidate, id } as Connector));
      }
    }
    return [...fromServer, ...fromOverrides];
  }, [
    connectors,
    runs,
    selectedConnectorIdSet,
    onlySelectedConnectorId,
    connectorOverrides,
    onConnectorLabelChange,
    reconnectableEdges,
    onPinEndpoint,
    handleEndpointContextMenu,
    registerEditHandle,
  ]);

  // Mirror rfEdges into a ref so onEdgesChange (declared earlier) reads the
  // latest value without recreating the callback on every render.
  useEffect(() => {
    rfEdgesRef.current = rfEdges;
  }, [rfEdges]);

  // `connectSucceededRef` lets onConnectEnd skip the body-drop fallback when
  // onConnect already fired (precise handle drop). Same pattern as
  // `reconnectSucceededRef` below.
  const connectSucceededRef = useRef(false);
  // US-023: drag-direction wins over React Flow's handle-type normalization.
  // RF's Connection payload places the source-type handle's node in `source`,
  // regardless of which node the user actually started dragging from. We
  // capture the drag origin in onConnectStart and re-swap downstream so the
  // persisted connector reflects the user's gesture, not RF's handle pairing.
  const connectStartRef = useRef<{ nodeId: string | null; handleType: HandleType | null } | null>(
    null,
  );
  // US-025: every new connector via onConnect is floating — drag-direction
  // determines source/target, but neither endpoint is pinned to a handle.
  // The user can later pin either side by reconnecting the endpoint onto a
  // specific handle dot.
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!onCreateConnector) return;
      const { source, target } = conn;
      if (!source || !target) return;
      // Reject same-node connections client-side — the schema would also
      // accept them but they're never useful (a node referencing itself).
      if (source === target) return;
      connectSucceededRef.current = true;
      // US-023: drag-direction wins. When RF normalized source ↔ target
      // (user dragged from a target-type handle to a source-type handle),
      // re-swap so source = drag-start and target = drag-end. With floating
      // (US-025), no handle ids are persisted so the swap is purely about
      // which node owns the source/target slot.
      const dragStartNodeId = connectStartRef.current?.nodeId ?? null;
      const reversed =
        dragStartNodeId !== null && dragStartNodeId === target && dragStartNodeId !== source;
      const persistSource = reversed ? target : source;
      const persistTarget = reversed ? source : target;
      onCreateConnector(persistSource, persistTarget);
    },
    [onCreateConnector],
  );

  // Body-drop fallback for NEW connections (US-014). When the user drags from
  // a source handle and releases over a node's BODY (not precisely on one of
  // its four handles), React Flow's connectionRadius isn't enough to snap and
  // onConnect doesn't fire. We catch that here, hit-test elementsFromPoint
  // for the topmost `.react-flow__node`, and call onCreateConnector with
  // drag-from as source and the body-drop node as target. US-025: no handle
  // ids — the new connector is floating.
  const onConnectEndCb = useCallback(
    (e: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      setConnecting(false);
      // US-017: clear the source/target DOM markers once the gesture ends so
      // the candidate-target highlight and outlet-hiding rule stop applying.
      // The pointermove tracker also clears its own state via the
      // `[connecting]` effect, but we clear here too so the markers go away
      // synchronously even if React batches the `setConnecting(false)` render.
      clearConnectMarkers();
      const succeeded = connectSucceededRef.current;
      connectSucceededRef.current = false;
      if (succeeded) return;
      // US-011: xyflow calls BOTH onConnectEnd AND onReconnectEnd at the end of
      // a reconnect drag (see @xyflow/system index.js: lines 2522-2525). For
      // empty-pane drops both fallbacks no-op (no node under cursor). But for
      // body-drops, this onConnectEndCb's hit-test would create a NEW connector
      // alongside the reconnect — producing a duplicate edge. Bail here so the
      // dedicated onReconnectEndCb handles the gesture exclusively.
      // `isReconnectingRef.current` is set in onReconnectStart and only cleared
      // at the top of onReconnectEndCb, which fires AFTER this callback per
      // xyflow's order — so reading it here reliably identifies reconnect
      // drags.
      if (isReconnectingRef.current) return;
      // US-006: ESC mid-drag cancels the connect — skip the body-drop fallback
      // entirely so the synthesized mouseup that ended the gesture doesn't
      // fall through and hit-test a stray edge into existence.
      if (connectCancelledRef.current) {
        connectCancelledRef.current = false;
        return;
      }
      if (!onCreateConnector) return;
      // Wrong-type handle drop: the user released precisely on a handle whose
      // role doesn't match the moving endpoint. React Flow refuses the drop
      // (no onConnect), so we flash the handle red and bail without falling
      // through to the body-drop fallback (US-022).
      const toHandle = connectionState.toHandle;
      if (toHandle && connectionState.isValid === false) {
        flashInvalidHandle(wrapperRef.current, toHandle.nodeId, toHandle.id);
        return;
      }
      const fromNodeId = connectionState.fromNode?.id;
      const fromHandle = connectionState.fromHandle;
      if (!fromNodeId || !fromHandle) return;
      const cursor = cursorFromConnectEvent(e);
      if (!cursor) return;
      const targetEl = nodeElAtPoint(cursor.clientX, cursor.clientY);
      if (targetEl) {
        const targetNodeId = targetEl.getAttribute('data-id');
        if (!targetNodeId || targetNodeId === fromNodeId) return;
        // US-023 + US-025: drag-from is always source, drop-node is always
        // target — including when the user drags from a target-type handle.
        // No handle ids are persisted; the resulting connector is floating.
        onCreateConnector(fromNodeId, targetNodeId);
        return;
      }
      // US-015: drop on empty canvas → open the create-and-connect popover at
      // the cursor. The picked shape becomes a new node at the drop position,
      // wired from the source. Skipped when the parent didn't wire the
      // callback (preserves the legacy "drop on pane → no-op" behaviour).
      if (!onCreateAndConnectFromPane) return;
      const rfInstance = rfInstanceRef.current;
      if (!rfInstance) return;
      const flowPos = rfInstance.screenToFlowPosition({
        x: cursor.clientX,
        y: cursor.clientY,
      });
      setDropPopover({
        clientX: cursor.clientX,
        clientY: cursor.clientY,
        flowX: flowPos.x,
        flowY: flowPos.y,
        sourceNodeId: fromNodeId,
      });
    },
    [onCreateConnector, onCreateAndConnectFromPane, clearConnectMarkers],
  );

  // Drag an edge endpoint onto another handle to reattach it. React Flow
  // computes the new connection from the gesture; we forward the diff
  // (source or target) to the parent for persistence. The parent applies
  // an optimistic override so the edge snaps immediately; the SSE echo of
  // the file rewrite reconciles any drift.
  //
  // `reconnectSucceededRef` lets onReconnectEnd skip the body-drop fallback
  // when onReconnect already fired for this gesture (precise handle drop).
  const reconnectSucceededRef = useRef(false);
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (!onReconnectConnector) return;
      const { source, target, sourceHandle, targetHandle } = newConnection;
      if (!source || !target || source === target) return;
      const patch: {
        source?: string;
        target?: string;
        sourceHandle?: string | null;
        targetHandle?: string | null;
        sourceHandleAutoPicked?: boolean;
        targetHandleAutoPicked?: boolean;
      } = {};
      if (source !== oldEdge.source) patch.source = source;
      if (target !== oldEdge.target) patch.target = target;
      // Forward handle changes too — same-node reconnect (e.g. dragging the
      // source endpoint from the right handle to the bottom handle on the
      // SAME node) only surfaces as a sourceHandle/targetHandle diff.
      if (typeof sourceHandle === 'string' && sourceHandle !== oldEdge.sourceHandle) {
        patch.sourceHandle = sourceHandle;
      }
      if (typeof targetHandle === 'string' && targetHandle !== oldEdge.targetHandle) {
        patch.targetHandle = targetHandle;
      }
      if (
        patch.source === undefined &&
        patch.target === undefined &&
        patch.sourceHandle === undefined &&
        patch.targetHandle === undefined
      ) {
        return;
      }
      // US-025: a precise handle drop pins the moved endpoint. Setting
      // *HandleAutoPicked: false flips the edge from floating to pinned at
      // render time. The unmoved side keeps its existing flag (no key set
      // in patch → server leaves it alone).
      if (patch.source !== undefined || patch.sourceHandle !== undefined) {
        patch.sourceHandleAutoPicked = false;
      }
      if (patch.target !== undefined || patch.targetHandle !== undefined) {
        patch.targetHandleAutoPicked = false;
      }
      reconnectSucceededRef.current = true;
      onReconnectConnector(oldEdge.id, patch);
    },
    [onReconnectConnector],
  );

  // Body-drop fallback: when the user releases the reconnect drag on a node's
  // body (rather than precisely on one of its four handles), React Flow's
  // connectionRadius isn't enough to snap to a handle and onReconnect doesn't
  // fire. We catch that here, look at the cursor's screen-space pointer and
  // hit-test which `.react-flow__node` is under it, and persist it as the new
  // endpoint for whichever side (source/target) was being dragged. Empty-space
  // drops resolve to no node and we no-op (the edge restores).
  //
  // We use elementsFromPoint(pointer) rather than connectionState.toNode
  // because React Flow only populates toNode when a handle is within
  // connectionRadius — so a drop on the node's body itself reports null.
  const onReconnectEndCb = useCallback(
    (
      e: MouseEvent | TouchEvent,
      oldEdge: Edge,
      handleType: HandleType,
      connectionState: FinalConnectionState,
    ) => {
      setConnecting(false);
      // US-017: same reasoning as onConnectEndCb — clear markers immediately
      // on gesture end so a successful reconnect doesn't leave a stale
      // candidate-target outline behind.
      clearConnectMarkers();
      // US-009: clear reconnect-in-flight flag so a follow-on new-connection
      // drag (a real onConnectStart, not a reconnect) sees a default-styled
      // connection line.
      isReconnectingRef.current = false;
      const succeeded = reconnectSucceededRef.current;
      reconnectSucceededRef.current = false;
      if (succeeded) return;
      // US-006: ESC cancellation parallel of onConnectEndCb above — skip the
      // body-drop reconnect fallback when the gesture was cancelled.
      if (reconnectCancelledRef.current) {
        reconnectCancelledRef.current = false;
        return;
      }
      if (!onReconnectConnector) return;
      // Wrong-type handle drop (US-022): the user dropped precisely on a
      // handle whose role doesn't match the moving endpoint (e.g. dragged a
      // target endpoint onto a source-only handle). React Flow refuses the
      // reconnect; flash the handle red and bail so the edge restores
      // unchanged.
      const toHandle = connectionState.toHandle;
      if (toHandle && connectionState.isValid === false) {
        flashInvalidHandle(wrapperRef.current, toHandle.nodeId, toHandle.id);
        return;
      }
      // Resolve the cursor's screen coordinates from either branch of the
      // event union (mouse vs. final touch). FinalConnectionState.pointer
      // would be nice but it's in flow space and it's also null when toHandle
      // is null — so the event's own coords are the durable source.
      const cursor = cursorFromConnectEvent(e);
      let droppedNodeId: string | null = connectionState.toNode?.id ?? null;
      if (!droppedNodeId && cursor) {
        const nodeEl = nodeElAtPoint(cursor.clientX, cursor.clientY);
        droppedNodeId = nodeEl?.getAttribute('data-id') ?? null;
      }
      if (!droppedNodeId) return;
      // React Flow passes the type of the FIXED (anchored) end, not the
      // moving one — e.g. dragging the target endpoint anchors the source,
      // so handleType === 'source'. Invert to determine which side moved.
      const movingSide: 'source' | 'target' = handleType === 'source' ? 'target' : 'source';
      if (movingSide === 'source') {
        if (droppedNodeId === oldEdge.source) return;
        if (droppedNodeId === oldEdge.target) return;
        // US-025: body-drop reconnect → floating endpoint. Clear any
        // previously-pinned sourceHandle by sending null (the API treats
        // null as "delete this field on disk") and set the autoPicked
        // flag so the renderer floats this end.
        onReconnectConnector(oldEdge.id, {
          source: droppedNodeId,
          sourceHandle: null,
          sourceHandleAutoPicked: true,
        });
      } else {
        if (droppedNodeId === oldEdge.target) return;
        if (droppedNodeId === oldEdge.source) return;
        onReconnectConnector(oldEdge.id, {
          target: droppedNodeId,
          targetHandle: null,
          targetHandleAutoPicked: true,
        });
      }
    },
    [onReconnectConnector, clearConnectMarkers],
  );

  const ghostRect = useMemo(() => {
    if (!drawStart || !drawCurrent) return null;
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const offsetX = wrapperRect?.left ?? 0;
    const offsetY = wrapperRect?.top ?? 0;
    const minX = Math.min(drawStart.x, drawCurrent.x);
    const minY = Math.min(drawStart.y, drawCurrent.y);
    const w = Math.abs(drawCurrent.x - drawStart.x);
    const h = Math.abs(drawCurrent.y - drawStart.y);
    // Coords are stored in client space; subtract the wrapper offset to paint
    // the ghost via absolute positioning inside the wrapper.
    return { left: minX - offsetX, top: minY - offsetY, width: w, height: h };
  }, [drawStart, drawCurrent]);

  // US-009: WYSIWYG ghost — mirror the committed shape's chrome via the same
  // helpers `ShapeNode` uses so background/border/radius/tilt match exactly.
  // Approach: reuse the node's style module (shapeChromeClass/shapeChromeStyle
  // from shape-node.tsx) with no `data` so we get the exact default look the
  // drag-create flow commits via `onCreateShapeNode` (which sends only
  // `{ shape, width, height }`). Text is intentionally chromeless on commit;
  // we add a faint dashed outline ONLY for the ghost so the user can see
  // what they're drawing — the placed text node still has no chrome.
  const ghostShapeClass = drawShape ? shapeChromeClass(drawShape) : '';
  const ghostShapeStyle = drawShape ? shapeChromeStyle(drawShape) : undefined;
  const ghostTextOutline = drawShape === 'text';

  // Space-held pan mode (US-019). React Flow's panActivationKeyCode='Space'
  // toggles the pane into pan-on-drag mode for the duration of the keypress;
  // we mirror that into local state purely so the wrapper can show a
  // grab/grabbing cursor (the rest of the behavior is owned by React Flow).
  // Suppress the keydown when focus is in an editable element so InlineEdit's
  // own space input still types a literal space.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  useEffect(() => {
    const isEditable = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return el instanceof HTMLElement && el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (isEditable(document.activeElement)) return;
      // Only flip the cursor — React Flow owns the actual pan gesture wiring.
      // preventDefault stops the browser from scrolling the page on Space.
      e.preventDefault();
      setSpaceHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      setSpaceHeld(false);
      setSpaceDragging(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Multi-node drag-stop: React Flow passes the full set of nodes that moved
  // (the active drag plus every other selected node, since selected items
  // drag together). US-013: when more than one node moved, route the whole
  // batch through `onNodePositionsChange` so the parent commits a single
  // undo entry; one Cmd+Z reverts every node back to its pre-drag position.
  // Single-node drags still flow through `onNodePositionChange` to preserve
  // the per-id coalesce key (collapses repeated drags of the same node).
  const commitDraggedNodes = useCallback(
    (draggedNodes: Node[]) => {
      if (draggedNodes.length === 0) return;
      if (draggedNodes.length === 1) {
        const moved = draggedNodes[0];
        if (moved && onNodePositionChange) {
          onNodePositionChange(moved.id, { x: moved.position.x, y: moved.position.y });
        }
        return;
      }
      if (onNodePositionsChange) {
        onNodePositionsChange(
          draggedNodes.map((n) => ({ id: n.id, position: { x: n.position.x, y: n.position.y } })),
        );
        return;
      }
      // Fallback: parent didn't wire the batch path → emit per-node calls so
      // the legacy behavior (N undo entries) still works.
      if (!onNodePositionChange) return;
      for (const moved of draggedNodes) {
        onNodePositionChange(moved.id, { x: moved.position.x, y: moved.position.y });
      }
    },
    [onNodePositionChange, onNodePositionsChange],
  );

  const onNodeDragStopCb = useCallback(
    (_e: unknown, _node: Node, draggedNodes: Node[]) => {
      draggingRef.current = false;
      commitDraggedNodes(draggedNodes);
    },
    [commitDraggedNodes],
  );

  const onSelectionDragStartCb = useCallback(() => {
    draggingRef.current = true;
  }, []);
  const onSelectionDragStopCb = useCallback(
    (_e: unknown, draggedNodes: Node[]) => {
      draggingRef.current = false;
      commitDraggedNodes(draggedNodes);
    },
    [commitDraggedNodes],
  );

  // Cursor for the wrapper. Draw mode → crosshair (own gesture). Space-held →
  // grab while idle, grabbing while a Space-pan drag is in flight. Else
  // default arrow — US-010 made primary-mouse drag a marquee gesture, but the
  // default cursor is the design-tool norm for the rubber-band so we don't
  // override it.
  const wrapperCursor = drawShape
    ? 'crosshair'
    : spaceHeld
      ? spaceDragging
        ? 'grabbing'
        : 'grab'
      : undefined;

  return (
    <div
      data-testid="anydemo-canvas"
      ref={wrapperRef}
      className="relative h-full w-full"
      style={wrapperCursor ? { cursor: wrapperCursor } : undefined}
      // US-010: capture-phase listener fires before xyflow's pane handlers.
      // Snapshots the additive base + shift state for a pending marquee so
      // the existing selection survives xyflow's reset (see the change-filter
      // in onNodesChange / onEdgesChange above).
      onPointerDownCapture={onWrapperPointerDownCapture}
      onPointerDown={(e) => {
        if (spaceHeld) setSpaceDragging(true);
        onPointerDown(e);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        setSpaceDragging(false);
        onPointerUp(e);
      }}
      onPointerCancel={() => {
        drawingRef.current = false;
        drawStartRef.current = null;
        drawCurrentRef.current = null;
        setDrawStart(null);
        setDrawCurrent(null);
        setSpaceDragging(false);
      }}
      // US-010: capture-phase right-click handler so a multi-selection
      // right-click opens OUR Radix menu instead of xyflow's single-node
      // menu (which would also clear the multi-selection en route).
      onContextMenuCapture={onWrapperContextMenuCapture}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        proOptions={{ hideAttribution: true }}
        fitView
        nodesDraggable={!!onNodePositionChange && !drawShape}
        nodesConnectable={!!onCreateConnector && !drawShape}
        className={connecting ? 'anydemo-connecting' : undefined}
        onConnect={onConnect}
        onConnectStart={(_e, params) => {
          setConnecting(true);
          connectSucceededRef.current = false;
          // US-023: capture the drag origin so onConnect / onConnectEnd can
          // tell which end the user actually started from, regardless of
          // React Flow's source-type-handle-first normalization.
          connectStartRef.current = {
            nodeId: params.nodeId ?? null,
            handleType: params.handleType ?? null,
          };
          // US-017: mark the source node so its own outlets stay visible
          // (others get hidden via CSS) for the duration of the drag.
          setConnectSource(params.nodeId ?? null);
        }}
        onConnectEnd={onConnectEndCb}
        onReconnect={onReconnectConnector ? onReconnect : undefined}
        onReconnectStart={(_e, edge, handleType) => {
          setConnecting(true);
          reconnectSucceededRef.current = false;
          // US-009: mark that this drag is a reconnect (vs new connection) so
          // the custom connection-line component mirrors the reconnecting
          // edge's style. Cleared in onReconnectEnd.
          isReconnectingRef.current = true;
          // US-017: the anchored end of the edge plays the "source" role for
          // outlet visibility — its outlets stay visible, others are hidden
          // via CSS. xyflow passes `handleType` as the type of the FIXED
          // (anchored) end, so the anchored node id is the matching side.
          const anchoredNodeId = handleType === 'source' ? edge.source : edge.target;
          setConnectSource(anchoredNodeId);
        }}
        onReconnectEnd={onReconnectEndCb}
        connectionLineComponent={connectionLineComponent}
        connectionLineStyle={{ strokeWidth: 2 }}
        // Generous connection radius so the user can release a connect or
        // reconnect drag near a handle without pixel-perfect aim. React Flow
        // snaps to the closest handle within this radius.
        connectionRadius={32}
        // US-024: SVG EdgeAnchor circle r=10 → 20px hit-region diameter, kept
        // intentionally larger than the visible portal-rendered endpoint dot
        // (sized via the shared --anydemo-handle-size token, also driving
        // outlet handle size) so the user gets a generous click target. The
        // SVG circle itself is rendered transparent via
        // `.react-flow__edgeupdater` CSS — only the portal dot is visible.
        reconnectRadius={10}
        // US-011: by default xyflow's `edgesReconnectable` is true, which makes
        // EVERY edge render EdgeAnchor circles regardless of selection.
        // Previously this was masked by `.react-flow__edgeupdater { opacity: 0 }`,
        // but now that we paint EdgeAnchor visibly, we need to restrict it to
        // the single-selected edge — disable the global default and let the
        // explicit `reconnectable: true` on the selected edge (set in `rfEdges`)
        // be the only switch that turns EdgeAnchor on.
        edgesReconnectable={false}
        // Keep selected nodes at the same z-stack level as their siblings
        // (US-014). React Flow's default would bump a selected node to
        // z-index 1000+, but selection is already conveyed by the outline
        // (US-005) and US-014 pins every node above every edge regardless
        // of selection — no extra node-vs-node elevation needed.
        elevateNodesOnSelect={false}
        elementsSelectable={!drawShape}
        // US-018: dragging an unselected node moves it WITHOUT auto-selecting
        // (and therefore without opening the detail panel). React Flow defaults
        // this to true; an explicit click (mousedown + mouseup without
        // movement) still selects via onNodeClick.
        selectNodesOnDrag={false}
        // US-010 selection model: primary-mouse drag on empty pane draws a
        // marquee (rubber-band) that multi-selects nodes + edges. Middle and
        // right-mouse drags pan. Space-held primary drag also pans (via
        // panActivationKeyCode below). Draw mode disables marquee + pan so the
        // toolbar's shape gesture owns primary-drag.
        //
        // SelectionMode.Partial: an edge / node selects if ANY part is inside
        // the marquee (matches the design-tool norm — strict-Full would only
        // select fully-contained shapes, which feels finicky).
        //
        // selectionKeyCode=null suppresses xyflow's modifier-marquee fallback
        // (default would be 'Shift') since selectionOnDrag already covers
        // marquee — keeping shift free for additive multi-select via click.
        selectionOnDrag={!drawShape}
        panOnDrag={drawShape ? false : [1, 2]}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode={null}
        multiSelectionKeyCode={drawShape ? null : ['Meta', 'Shift']}
        panActivationKeyCode={drawShape ? null : 'Space'}
        // US-010: lift the marquee end to a single onSelectionChange call so
        // the parent's `selectedNodeIds` / `selectedConnectorIds` props don't
        // churn per frame. The onNodesChange / onEdgesChange handlers above
        // accumulate the live changes into local refs; this fires once on
        // pointer-up.
        onSelectionStart={onSelectionStartCb}
        onSelectionEnd={onSelectionEndCb}
        // US-010: keep edges above sibling nodes but below the future group
        // label slot (US-014). Setting via defaultEdgeOptions is preferred to
        // a per-edge zIndex because it doesn't churn edge identity through
        // connectorToEdge — the option propagates through xyflow's default
        // edge merging.
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        zoomOnDoubleClick={false}
        onInit={(instance) => {
          rfInstanceRef.current = instance;
          onRfInit?.(instance);
        }}
        onMove={() => {
          // US-015: panning or zooming the canvas dismisses the drop-popover —
          // the anchor's flow-space coordinates would otherwise drift away
          // from the viewport translation. Read from the ref to avoid
          // re-binding on every popover open/close (onMove fires every frame
          // while the user pans/zooms).
          if (dropPopoverRef.current) setDropPopover(null);
        }}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={() => {
          draggingRef.current = true;
        }}
        onNodeDragStop={onNodeDragStopCb}
        onSelectionDragStart={onSelectionDragStartCb}
        onSelectionDragStop={onSelectionDragStopCb}
        // US-003: route React Flow's click-only events to the parent so the
        // detail panel can be driven by explicit clicks instead of selection
        // changes. xyflow's `onNodeClick`/`onEdgeClick` fire only for real
        // clicks (mousedown + mouseup without crossing the drag threshold);
        // node-drag gestures don't trigger them, so a drag no longer opens
        // the panel as a side effect.
        onNodeClick={onNodeClick ? (_e, node) => onNodeClick(node.id) : undefined}
        onEdgeClick={onConnectorClick ? (_e, edge) => onConnectorClick(edge.id) : undefined}
        // US-018: double-click anywhere on the edge body opens the inline
        // label editor (not just the existing label-button onDoubleClick). The
        // per-edge `registerEditHandle` map gives us O(1) dispatch without
        // forcing edge identity to change when editing state flips.
        onEdgeDoubleClick={(_e, edge) => {
          editHandlesRef.current.get(edge.id)?.();
        }}
        onPaneClick={onPaneClick}
        onNodeContextMenu={
          contextEnabled
            ? (e, node) => {
                // Suppress the browser's default menu and open our own at the
                // cursor. The id sticks in a ref (read by item callbacks); the
                // position state drives the trigger-position effect that
                // dispatches the synthetic contextmenu event.
                e.preventDefault();
                contextNodeIdRef.current = node.id;
                setContextOnNode(true);
                setContextNodeType(node.type ?? null);
                setContextEndpoint(null);
                setContextMenuPos({ x: e.clientX, y: e.clientY });
              }
            : undefined
        }
        onPaneContextMenu={
          onPasteAt
            ? (e) => {
                // Right-click on empty canvas opens the same menu but with
                // only the pane-applicable items (Paste). The "ContextMenu"
                // event delivered here is either a synthetic ReactMouseEvent
                // (from React Flow's wrapper) OR a native MouseEvent — both
                // expose preventDefault + clientX/clientY.
                e.preventDefault();
                contextNodeIdRef.current = null;
                setContextOnNode(false);
                setContextNodeType(null);
                setContextEndpoint(null);
                setContextMenuPos({ x: e.clientX, y: e.clientY });
              }
            : undefined
        }
      >
        <StoreApiBridge storeApiRef={storeApiRef} />
        <Background gap={12} size={0.6} />
        <Controls showInteractive={false} />
        {onCreateShapeNode || onStyleNode || onStyleConnector ? (
          <Panel position="top-left">
            <div className="flex flex-col gap-2">
              {onCreateShapeNode ? (
                <CanvasToolbar
                  activeShape={drawShape}
                  onSelectShape={setDrawShape}
                  onTidy={onTidy}
                  onExportSvg={onExportSvg}
                  onExportPdf={onExportPdf}
                  iconPickerOpen={iconPickerOpen ?? false}
                  onOpenIconPicker={onOpenIconPicker}
                  onCloseIconPicker={onCloseIconPicker}
                  onPickIcon={onPickIcon}
                />
              ) : null}
              {onStyleNode && onStyleConnector ? (
                <StyleStrip
                  nodes={selectedNodes ?? []}
                  connectors={selectedConnectors ?? []}
                  onStyleNode={onStyleNode}
                  onStyleNodePreview={onStyleNodePreview}
                  onStyleNodes={onStyleNodes}
                  onStyleNodesPreview={onStyleNodesPreview}
                  onStyleConnector={onStyleConnector}
                  onStyleConnectorPreview={onStyleConnectorPreview}
                  onRequestIconReplace={onRequestIconReplace}
                />
              ) : null}
            </div>
          </Panel>
        ) : null}
      </ReactFlow>
      {ghostRect ? (
        <div
          data-testid="canvas-draw-ghost"
          data-ghost-shape={drawShape ?? undefined}
          aria-hidden
          className={cn(
            'pointer-events-none absolute z-10',
            ghostShapeClass,
            ghostTextOutline ? 'rounded-sm border border-dashed border-muted-foreground/40' : '',
          )}
          style={{
            ...ghostShapeStyle,
            left: ghostRect.left,
            top: ghostRect.top,
            width: ghostRect.width,
            height: ghostRect.height,
          }}
        />
      ) : null}
      {contextEnabled ? (
        <ContextMenu
          onOpenChange={(open) => {
            if (!open) {
              setContextMenuPos(null);
              contextNodeIdRef.current = null;
              setContextNodeType(null);
              setContextEndpoint(null);
            }
          }}
        >
          <ContextMenuTrigger asChild>
            <div
              ref={contextTriggerRef}
              data-testid="node-context-menu-trigger"
              aria-hidden
              className="pointer-events-none fixed"
              style={{
                left: contextMenuPos?.x ?? 0,
                top: contextMenuPos?.y ?? 0,
                width: 0,
                height: 0,
              }}
            />
          </ContextMenuTrigger>
          <ContextMenuContent data-testid="node-context-menu">
            {contextEndpoint?.pinned && onUnpinEndpoint ? (
              <ContextMenuItem
                data-testid="connector-endpoint-context-menu-unpin"
                onSelect={handleUnpinPick}
              >
                Unpin
              </ContextMenuItem>
            ) : null}
            {contextOnNode && onCopyNode ? (
              <ContextMenuItem data-testid="node-context-menu-copy" onSelect={handleCopyPick}>
                Copy
                <ContextMenuShortcut>{copyShortcut}</ContextMenuShortcut>
              </ContextMenuItem>
            ) : null}
            {onPasteAt ? (
              <ContextMenuItem
                data-testid="node-context-menu-paste"
                disabled={!hasClipboard}
                onSelect={handlePastePick}
              >
                Paste
                <ContextMenuShortcut>{pasteShortcut}</ContextMenuShortcut>
              </ContextMenuItem>
            ) : null}
            {contextOnNode &&
            (onCopyNode || onPasteAt) &&
            // US-003 / US-012 / US-013: include 'Change icon', multi-selection
            // 'Group', and any-group 'Ungroup' in the "has-following-section"
            // check so the Copy/Paste → following-section separator renders
            // for any of them.
            ((groupableCount >= 2 && ungroupableCount === 0 && !!onGroupNodes) ||
              (ungroupableCount >= 1 && !!onUngroupSelection) ||
              (contextNodeType === 'iconNode' && !!onRequestIconReplace) ||
              onReorderNode ||
              onDeleteNode) ? (
              <ContextMenuSeparator />
            ) : null}
            {/* US-012: multi-selection Group action. Visible whenever ≥ 2 of
                the selected nodes are groupable (filtered by
                `selectGroupableSet`) AND no group is in the current
                selection — mutually exclusive with the US-013 "Ungroup" item
                below, per the AC's "a selection that includes at least one
                group shows Ungroup (and not Group)" rule. Independent of
                which node the right-click landed on, so it works for the
                wrapper-level multi-selection capture path from US-010 too. */}
            {groupableCount >= 2 && ungroupableCount === 0 && onGroupNodes ? (
              <ContextMenuItem data-testid="node-context-menu-group" onSelect={handleGroupPick}>
                Group
              </ContextMenuItem>
            ) : null}
            {/* US-013: dissolve every group in the selection back into free
                nodes. Visible when ≥ 1 selected node is a group (filtered by
                `selectUngroupableSet`); mutually exclusive with the US-012
                Group item above. Single-group right-clicks land here too —
                the menu item shows even when only one group is selected. */}
            {ungroupableCount >= 1 && onUngroupSelection ? (
              <ContextMenuItem data-testid="node-context-menu-ungroup" onSelect={handleUngroupPick}>
                Ungroup
              </ContextMenuItem>
            ) : null}
            {((groupableCount >= 2 && ungroupableCount === 0 && onGroupNodes) ||
              (ungroupableCount >= 1 && onUngroupSelection)) &&
            ((contextNodeType === 'iconNode' && !!onRequestIconReplace) ||
              onReorderNode ||
              onDeleteNode) ? (
              <ContextMenuSeparator />
            ) : null}
            {contextOnNode && contextNodeType === 'iconNode' && onRequestIconReplace ? (
              <ContextMenuItem
                data-testid="node-context-menu-change-icon"
                onSelect={handleChangeIconPick}
              >
                Change icon
              </ContextMenuItem>
            ) : null}
            {contextOnNode &&
            contextNodeType === 'iconNode' &&
            onRequestIconReplace &&
            (onReorderNode || onDeleteNode) ? (
              <ContextMenuSeparator />
            ) : null}
            {contextOnNode && onReorderNode ? (
              <>
                <ContextMenuItem
                  data-testid="node-context-menu-to-front"
                  onSelect={() => handleReorderPick({ op: 'toFront' })}
                >
                  Bring to front
                </ContextMenuItem>
                <ContextMenuItem
                  data-testid="node-context-menu-forward"
                  onSelect={() => handleReorderPick({ op: 'forward' })}
                >
                  Bring forward
                </ContextMenuItem>
                <ContextMenuItem
                  data-testid="node-context-menu-backward"
                  onSelect={() => handleReorderPick({ op: 'backward' })}
                >
                  Send backward
                </ContextMenuItem>
                <ContextMenuItem
                  data-testid="node-context-menu-to-back"
                  onSelect={() => handleReorderPick({ op: 'toBack' })}
                >
                  Send to back
                </ContextMenuItem>
              </>
            ) : null}
            {contextOnNode && onReorderNode && onDeleteNode ? <ContextMenuSeparator /> : null}
            {contextOnNode && onDeleteNode ? (
              <ContextMenuItem data-testid="node-context-menu-delete" onSelect={handleDeletePick}>
                Delete
              </ContextMenuItem>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      ) : null}
      {onCreateAndConnectFromPane ? (
        <Popover
          open={!!dropPopover}
          onOpenChange={(open) => {
            // Radix-driven dismissals (outside-click, ESC inside the popover,
            // programmatic close on commit) all funnel through here. Map the
            // close back to clearing our state so the next drop can re-anchor.
            if (!open) setDropPopover(null);
          }}
        >
          {/* PopoverAnchor is a 0×0 fixed-position element pinned to the cursor
              at drop time; the Popover content positions relative to it. */}
          <PopoverAnchor asChild>
            <div
              data-testid="drop-popover-anchor"
              aria-hidden
              className="pointer-events-none fixed"
              style={{
                left: dropPopover?.clientX ?? 0,
                top: dropPopover?.clientY ?? 0,
                width: 0,
                height: 0,
              }}
            />
          </PopoverAnchor>
          <PopoverContent
            data-testid="drop-popover"
            align="start"
            side="bottom"
            sideOffset={4}
            className="w-auto p-1"
            onOpenAutoFocus={(e) => {
              // Don't pull focus into the popover — keep it on the canvas so
              // the wrapper-level ESC handler still receives keypresses.
              e.preventDefault();
            }}
          >
            <div role="menu" aria-label="Create connected node" className="flex flex-col gap-0.5">
              {TOOLBAR_SHAPES.map(({ shape, label, Icon }) => (
                <button
                  key={shape}
                  type="button"
                  role="menuitem"
                  data-testid={`drop-popover-shape-${shape}`}
                  onClick={() => {
                    const dp = dropPopover;
                    if (!dp) return;
                    onCreateAndConnectFromPane({
                      sourceNodeId: dp.sourceNodeId,
                      position: { x: dp.flowX, y: dp.flowY },
                      shape,
                    });
                    setDropPopover(null);
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                    'hover:bg-accent hover:text-accent-foreground',
                    'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                  )}
                >
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
