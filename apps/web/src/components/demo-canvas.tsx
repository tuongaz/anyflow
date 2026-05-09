import { CanvasToolbar } from '@/components/canvas-toolbar';
import { EditableEdge, type EditableEdgeData } from '@/components/edges/editable-edge';
import { PlayNode } from '@/components/nodes/play-node';
import { SHAPE_DEFAULT_SIZE, ShapeNode } from '@/components/nodes/shape-node';
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
import type { NodeRuns } from '@/hooks/use-node-runs';
import type { OverrideMap } from '@/hooks/use-pending-overrides';
import type { Connector, DemoNode, ReorderOp, ShapeKind } from '@/lib/api';
import { connectorToEdge } from '@/lib/connector-to-edge';
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
   * Fired once per resize-stop with the node's final dimensions. Wiring this
   * enables NodeResizer's resize handles inside each custom node.
   */
  onNodeResize?: (nodeId: string, dims: { width: number; height: number }) => void;
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

const nodeTypes = { playNode: PlayNode, stateNode: StateNode, shapeNode: ShapeNode };
const edgeTypes = { editableEdge: EditableEdge };

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
 * US-006: bridge for ESC cancellation of in-flight connection / marquee
 * gestures. xyflow exposes `cancelConnection` and the user-selection store
 * fields only via the internal store, which is reachable through `useStoreApi`
 * — and that hook only resolves inside `<ReactFlowProvider>`. Rendering this
 * tiny child as a `<ReactFlow>` descendant lets the outer component grab the
 * store handle through a ref without restructuring the wrapper.
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
 * before drag-create / connection / marquee / selection).
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
  // Used to call `cancelConnection` and clear the user-selection rect when
  // ESC cancels an in-flight connection or marquee.
  const storeApiRef = useRef<StoreApi | null>(null);
  const [drawShape, setDrawShape] = useState<ShapeKind | null>(null);
  // Mid-connect (or mid-reconnect) flag drives a wrapper class so handles on
  // every node stay visible until the gesture releases — the source has
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
  // US-009: memoize the connection-line component so React Flow doesn't see a
  // new identity each render and remount the line mid-drag. The component
  // closes over `isReconnectingRef`; the ref itself is stable across renders.
  const connectionLineComponent = useMemo(
    () => buildReconnectAwareConnectionLine(isReconnectingRef),
    [],
  );
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
  //   4. Marquee drag — restore the pre-marquee selection snapshot, clear
  //      xyflow's userSelection state, drop our pointer-tracking refs.
  //   5. Selection — clear node + connector selections.
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
      // 4. Marquee drag. We treat marquee as in-progress whenever our
      //    pointerdown-on-pane ref is set — even if xyflow hasn't moved past
      //    paneClickDistance yet. Either way, cancellation restores the
      //    pre-pointerdown selection snapshot so AC #4 ("selection is left
      //    unchanged") holds in both regimes.
      if (marqueeStartRef.current) {
        const snapshot = marqueeSelectionSnapshotRef.current;
        if (snapshot) {
          e.preventDefault();
          // Clear xyflow's user-selection state synchronously. The pointer is
          // still down; subsequent pointermoves return early because
          // userSelectionRect is null.
          try {
            storeApiRef.current?.setState({
              userSelectionActive: false,
              userSelectionRect: null,
            });
          } catch {
            // store unavailable — selection restore below still wins on the
            // next render via the controlled selectedNodeIds prop.
          }
          // Restore selection. Parent's setSelectedIds → sourceNodes recompute
          // → setRfNodes via the `[sourceNodes]` effect → fresh node refs
          // override xyflow's internalNode.selected mutation (US-005 pattern).
          onSelectionChangeRef.current?.(snapshot.nodes, snapshot.connectors);
          marqueeStartRef.current = null;
          marqueeCurrentRef.current = null;
          marqueeSelectionSnapshotRef.current = null;
          return;
        }
      }
      // 5. Selection clear.
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
      const dragWidth = maxX - minX;
      const dragHeight = maxY - minY;
      // Below MIN_DRAW_SIZE on either axis we treat the gesture as an
      // accidental click / tiny nudge and fall back to SHAPE_DEFAULT_SIZE
      // for that shape so single-clicks still produce a usable node.
      const tooSmall = dragWidth < MIN_DRAW_SIZE || dragHeight < MIN_DRAW_SIZE;
      const width = tooSmall ? SHAPE_DEFAULT_SIZE[shape].width : dragWidth;
      const height = tooSmall ? SHAPE_DEFAULT_SIZE[shape].height : dragHeight;
      // Coords are already in client space — feed directly to React Flow's
      // screen→flow projection. Avoids drift from wrapper rect changes
      // between pointerdown and pointerup.
      const flowPos = rfInstance.screenToFlowPosition({ x: minX, y: minY });
      onCreateShapeNode?.(shape, flowPos, { width, height });
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
  const contextEnabled = !!onReorderNode || !!onDeleteNode || !!onCopyNode || !!onPasteAt;
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  // Whether the most recent right-click landed on a node (true) vs. the empty
  // pane (false). Used to gate per-node items (Copy / reorder / Delete) which
  // don't make sense for an empty-canvas right-click. State (not just a ref)
  // because the menu's children are read on render — and the menu re-renders
  // when contextMenuPos changes, so this stays in sync via the same setState
  // pair below.
  const [contextOnNode, setContextOnNode] = useState(false);
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
          onPlay: onPlayNode,
          onResize: onNodeResize,
          setResizing,
          onLabelChange: onNodeLabelChange,
          onDescriptionChange: merged.type === 'shapeNode' ? undefined : onNodeDescriptionChange,
        },
        selected: selectedNodeIdSet.has(merged.id),
      };
      // Pass explicit width/height to the React Flow node wrapper when set
      // in data. NodeResizer dispatches dimension changes that update these
      // during a gesture; we only persist (and hence sync them back into
      // data) on resize-stop.
      if (merged.data.width !== undefined) node.width = merged.data.width;
      if (merged.data.height !== undefined) node.height = merged.data.height;
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
    return [...fromServer, ...fromOverrides];
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

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Marquee-aware filter. Computes the live marquee rect from our own
    // pointer-tracking refs (set in the wrapper's pointerdown/move handlers);
    // xyflow's `.react-flow__selection` DOM isn't yet in the tree when this
    // first fires from the marquee start, so DOM-based detection would miss
    // the critical resetSelectedElements + initial getSelectionChanges calls.
    //
    // - US-004: drop xyflow's `forceInitialRender` false-positives — a node
    //   whose handleBounds haven't settled yet gets swept into a partial-mode
    //   marquee even when it doesn't overlap; hit-test rules those out.
    //   Shift-marquee additionally drops ALL `select: false` changes so the
    //   prior selection survives xyflow's resetSelectedElements (xyflow's
    //   marquee always replaces, regardless of multi-selection key).
    // - US-005: in a normal (non-Shift) marquee, drop `select: false` for
    //   nodes still inside the rect. xyflow's marquee start emits select:false
    //   (resetSelectedElements) immediately followed by select:true
    //   (getSelectionChanges) for the same nodes — without dropping the
    //   deselect, the .selected class flickers off→on between renders, which
    //   makes <ResizeControls visible={selected}> unmount + remount its 8
    //   NodeResizeControl elements (4 line + 4 corner) on every cycle. That
    //   mount/unmount thrash is the visible flash.
    const marqueeStart = marqueeStartRef.current;
    const marqueeCurrent = marqueeCurrentRef.current;
    const marqueeRect =
      marqueeStart && marqueeCurrent
        ? {
            left: Math.min(marqueeStart.x, marqueeCurrent.x),
            top: Math.min(marqueeStart.y, marqueeCurrent.y),
            right: Math.max(marqueeStart.x, marqueeCurrent.x),
            bottom: Math.max(marqueeStart.y, marqueeCurrent.y),
          }
        : null;
    const shiftMarquee = !!marqueeRect && shiftHeldRef.current;
    // US-005: ids whose `select: false` we dropped in the filter below. xyflow's
    // `getSelectionChanges` mutates `internalNode.selected = false` directly on
    // the lookup BEFORE invoking onNodesChange, so dropping the change in our
    // filter alone isn't enough — when our setRfNodes prop comes back, xyflow's
    // `adoptUserNodes(checkEquality: true)` reuses the same internalNode (because
    // the userNode reference is unchanged) and the `selected: false` mutation
    // sticks until the next render. The fix: stamp these ids with a fresh
    // userNode reference + `selected: true` so adoptUserNodes detects a ref
    // change, rebuilds the internalNode from our prop, and restores selected.
    const droppedDeselectIds = new Set<string>();
    const filteredChanges = !marqueeRect
      ? changes
      : changes.filter((c) => {
          if (c.type !== 'select') return true;
          const nodeEl = wrapperRef.current?.querySelector(
            `.react-flow__node[data-id="${CSS.escape(c.id)}"]`,
          );
          // Can't measure: for select:true keep (xyflow's call); for
          // select:false fall back to existing behaviour (drop iff Shift).
          if (!nodeEl) {
            if (c.selected) return true;
            if (shiftMarquee) {
              droppedDeselectIds.add(c.id);
              return false;
            }
            return true;
          }
          const nodeRect = nodeEl.getBoundingClientRect();
          const ox =
            Math.min(marqueeRect.right, nodeRect.right) - Math.max(marqueeRect.left, nodeRect.left);
          const oy =
            Math.min(marqueeRect.bottom, nodeRect.bottom) - Math.max(marqueeRect.top, nodeRect.top);
          const inRect = ox > 0 && oy > 0;
          if (c.selected) return inRect;
          // c.selected === false. Shift-marquee preserves the prior selection
          // entirely. Plain marquee preserves only nodes still in the rect —
          // those will get a select:true emitted in the same tick anyway.
          const drop = shiftMarquee || inRect;
          if (drop) droppedDeselectIds.add(c.id);
          return !drop;
        });
    const explicitlyToggled = new Set<string>();
    for (const c of filteredChanges) {
      if (c.type === 'select') explicitlyToggled.add(c.id);
    }
    // applyNodeChanges on the current snapshot. We feed the same result to
    // setRfNodes below so the rendered nodes match what we're propagating.
    const next = applyNodeChanges(filteredChanges, rfNodesRef.current);
    const pinned = selectedIdSetRef.current;
    // Re-pin selection. Two cases:
    //  - resize/dimension changes can transiently drop the `selected` flag —
    //    restore it for nodes in `pinned` that the user didn't explicitly
    //    toggle (US-019).
    //  - dropped-deselects (US-005): xyflow already mutated the lookup's
    //    `selected: false`; force a fresh userNode ref with `selected: true`
    //    so adoptUserNodes rebuilds the internalNode on the next render.
    const repinned =
      pinned.size === 0 && droppedDeselectIds.size === 0
        ? next
        : next.map((n) => {
            if (droppedDeselectIds.has(n.id)) return { ...n, selected: true };
            if (pinned.has(n.id) && !explicitlyToggled.has(n.id) && !n.selected) {
              return { ...n, selected: true };
            }
            return n;
          });
    // Keep the ref in sync synchronously so a second onNodesChange in the
    // same task (xyflow does this at marquee start: resetSelectedElements
    // immediately followed by getSelectionChanges) composes against the
    // freshest result — otherwise applyNodeChanges would re-apply against
    // the stale pre-commit value and overwrite this call's fresh refs.
    rfNodesRef.current = repinned;
    setRfNodes(repinned);
    // Propagate user-driven selection changes up to the parent. Programmatic
    // prop updates bypass this — ReactFlow's StoreUpdater applies them
    // directly to the store without dispatching changes.
    if (explicitlyToggled.size === 0) return;
    const cb = onSelectionChangeRef.current;
    if (!cb) return;
    const sel = repinned.filter((n) => n.selected).map((n) => n.id);
    const prev = selectedIdSetRef.current;
    const sameLen = prev.size === sel.length;
    const sameAll = sameLen && sel.every((id) => prev.has(id));
    if (sameAll) return;
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
    const explicitlyToggled = new Set<string>();
    for (const c of changes) {
      if (c.type === 'select') explicitlyToggled.add(c.id);
    }
    if (explicitlyToggled.size === 0) return;
    const cb = onSelectionChangeRef.current;
    if (!cb) return;
    const next = applyEdgeChanges(changes, rfEdgesRef.current);
    const sel = next.filter((e) => e.selected).map((e) => e.id);
    const prev = selectedConnIdSetRef.current;
    const sameLen = prev.size === sel.length;
    const sameAll = sameLen && sel.every((id) => prev.has(id));
    if (sameAll) return;
    cb([...selectedIdSetRef.current], sel);
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
      return { ...next, data: { ...next.data, onLabelChange: onConnectorLabelChange } };
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
      const succeeded = connectSucceededRef.current;
      connectSucceededRef.current = false;
      if (succeeded) return;
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
      if (!targetEl) return;
      const targetNodeId = targetEl.getAttribute('data-id');
      if (!targetNodeId || targetNodeId === fromNodeId) return;
      // US-023 + US-025: drag-from is always source, drop-node is always
      // target — including when the user drags from a target-type handle.
      // No handle ids are persisted; the resulting connector is floating.
      onCreateConnector(fromNodeId, targetNodeId);
    },
    [onCreateConnector],
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
    [onReconnectConnector],
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

  const ghostShapeClass =
    drawShape === 'ellipse'
      ? 'rounded-full border-2 border-primary/60 bg-primary/10'
      : drawShape === 'sticky'
        ? 'rounded-md border border-amber-500/60 bg-amber-200/40'
        : 'rounded-lg border-2 border-primary/60 bg-primary/10';

  // US-004: Shift-marquee adds to the existing selection, and we filter
  // xyflow's `forceInitialRender` over-selection. Tracked via refs because
  // both checks need to fire INSIDE `onNodesChange`, which runs synchronously
  // from xyflow's first pointermove — before React has committed the
  // pointerdown render that would put `.react-flow__selection` in the DOM.
  const shiftHeldRef = useRef(false);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeCurrentRef = useRef<{ x: number; y: number } | null>(null);
  // US-006: snapshot of selection state at marquee start so ESC mid-drag can
  // restore it. Set on pointerdown (when target is the React Flow pane and
  // not in pan/draw mode); cleared on pointerup or after ESC restoration.
  const marqueeSelectionSnapshotRef = useRef<{
    nodes: string[];
    connectors: string[];
  } | null>(null);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftHeldRef.current = true;
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftHeldRef.current = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

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
  // drag together). Persist each moved node's final position individually —
  // the parent's onNodePositionChange already coalesces undo entries per id.
  const onNodeDragStopCb = useCallback(
    (_e: unknown, _node: Node, draggedNodes: Node[]) => {
      draggingRef.current = false;
      if (!onNodePositionChange) return;
      for (const moved of draggedNodes) {
        onNodePositionChange(moved.id, { x: moved.position.x, y: moved.position.y });
      }
    },
    [onNodePositionChange],
  );

  const onSelectionDragStartCb = useCallback(() => {
    draggingRef.current = true;
  }, []);
  const onSelectionDragStopCb = useCallback(
    (_e: unknown, draggedNodes: Node[]) => {
      draggingRef.current = false;
      if (!onNodePositionChange) return;
      for (const moved of draggedNodes) {
        onNodePositionChange(moved.id, { x: moved.position.x, y: moved.position.y });
      }
    },
    [onNodePositionChange],
  );

  // Cursor for the wrapper. Draw mode → crosshair (own gesture). Space-held →
  // grab while idle, grabbing while a Space-pan drag is in flight. Else
  // default — selectionOnDrag means the pane shows a normal cursor and the
  // marquee paints itself.
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
      onPointerDown={(e) => {
        if (spaceHeld) setSpaceDragging(true);
        // US-004: track marquee gesture in client-space refs so onNodesChange
        // can compute intersections / detect Shift-marquee BEFORE xyflow's
        // `.react-flow__selection` element exists in the DOM.
        if (!drawShape && !spaceHeld) {
          const target = e.target as HTMLElement | null;
          if (target?.classList.contains('react-flow__pane')) {
            const start = { x: e.clientX, y: e.clientY };
            marqueeStartRef.current = start;
            marqueeCurrentRef.current = start;
            // US-006: capture pre-marquee selection so ESC can restore it.
            // Read from refs (kept in sync with the controlled props) — props
            // are stale across re-renders but the refs always reflect the
            // latest committed selection.
            marqueeSelectionSnapshotRef.current = {
              nodes: [...selectedIdSetRef.current],
              connectors: [...selectedConnIdSetRef.current],
            };
          }
        }
        onPointerDown(e);
      }}
      onPointerMoveCapture={(e) => {
        // Capture phase so the ref is fresh BEFORE xyflow's pane onPointerMove
        // (bubble) runs resetSelectedElements / getSelectionChanges. Without
        // this, the first marquee step would still see start==current and
        // drop every valid pickup as a 0×0 rect.
        if (marqueeStartRef.current) {
          marqueeCurrentRef.current = { x: e.clientX, y: e.clientY };
        }
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        marqueeStartRef.current = null;
        marqueeCurrentRef.current = null;
        marqueeSelectionSnapshotRef.current = null;
        setSpaceDragging(false);
        onPointerUp(e);
      }}
      onPointerCancel={() => {
        marqueeStartRef.current = null;
        marqueeCurrentRef.current = null;
        marqueeSelectionSnapshotRef.current = null;
        drawingRef.current = false;
        drawStartRef.current = null;
        drawCurrentRef.current = null;
        setDrawStart(null);
        setDrawCurrent(null);
        setSpaceDragging(false);
      }}
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
        }}
        onConnectEnd={onConnectEndCb}
        onReconnect={onReconnectConnector ? onReconnect : undefined}
        onReconnectStart={() => {
          setConnecting(true);
          reconnectSucceededRef.current = false;
          // US-009: mark that this drag is a reconnect (vs new connection) so
          // the custom connection-line component mirrors the reconnecting
          // edge's style. Cleared in onReconnectEnd.
          isReconnectingRef.current = true;
        }}
        onReconnectEnd={onReconnectEndCb}
        connectionLineComponent={connectionLineComponent}
        // Generous connection radius so the user can release a connect or
        // reconnect drag near a handle without pixel-perfect aim. React Flow
        // snaps to the closest handle within this radius.
        connectionRadius={32}
        // Don't elevate selected nodes above edges (US-007). React Flow's
        // default bumps a selected node to z-index 1000+, which would push it
        // above any connector that crosses it; selection is already conveyed
        // by the outline (US-005), so we don't need the elevation.
        elevateNodesOnSelect={false}
        elementsSelectable={!drawShape}
        // US-019 selection model: marquee on drag, Space to pan. With
        // panOnDrag=false, plain pane drags create a selection rectangle;
        // panActivationKeyCode='Space' temporarily enables pan-on-drag while
        // Space is held. Multi-key (Meta/Shift) toggles individual items in
        // the selection. selectionKeyCode=null avoids overloading another
        // modifier (the marquee is already the default drag gesture).
        // US-004: partial-intersection mode — a node is picked up by the
        // marquee as soon as the rectangle overlaps it, instead of having
        // to fully contain it (xyflow's `Full` default).
        selectionOnDrag={!drawShape}
        selectionMode={SelectionMode.Partial}
        panOnDrag={false}
        selectionKeyCode={null}
        multiSelectionKeyCode={drawShape ? null : ['Meta', 'Shift']}
        panActivationKeyCode={drawShape ? null : 'Space'}
        zoomOnDoubleClick={false}
        onInit={(instance) => {
          rfInstanceRef.current = instance;
          onRfInit?.(instance);
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
                />
              ) : null}
            </div>
          </Panel>
        ) : null}
      </ReactFlow>
      {ghostRect ? (
        <div
          data-testid="canvas-draw-ghost"
          aria-hidden
          className={cn('pointer-events-none absolute z-10', ghostShapeClass)}
          style={{
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
            {contextOnNode && (onCopyNode || onPasteAt) && (onReorderNode || onDeleteNode) ? (
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
    </div>
  );
}
