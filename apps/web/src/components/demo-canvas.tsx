import { CanvasToolbar } from '@/components/canvas-toolbar';
import { EditableEdge } from '@/components/edges/editable-edge';
import { PlayNode } from '@/components/nodes/play-node';
import { SHAPE_DEFAULT_SIZE, ShapeNode } from '@/components/nodes/shape-node';
import { StateNode } from '@/components/nodes/state-node';
import type { NodeStatus } from '@/components/nodes/status-pill';
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
  Controls,
  type Edge,
  type FinalConnectionState,
  type HandleType,
  type Node,
  type NodeChange,
  Panel,
  ReactFlow,
  type ReactFlowInstance,
  applyNodeChanges,
} from '@xyflow/react';
import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import '@xyflow/react/dist/style.css';

export interface DemoCanvasProps {
  nodes: DemoNode[];
  connectors: Connector[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  /** Currently selected connector id (mutually exclusive with selectedNodeId). */
  selectedConnectorId?: string | null;
  /** Click handler for a connector edge; null clears the selection. */
  onSelectConnector?: (id: string | null) => void;
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
   * parent never sees them. `sourceHandle`/`targetHandle` carry the
   * handle ids React Flow attached the drag to (US-013).
   */
  onCreateConnector?: (
    source: string,
    target: string,
    handles?: { sourceHandle?: string; targetHandle?: string },
  ) => void;
  /**
   * Reattach an existing connector's source or target to a different node, or
   * to a different handle on the same node. Wired enables React Flow's edge
   * reconnect gesture: drag an edge endpoint onto another handle to call this
   * with the new source/target/handle ids. The patch only includes the fields
   * that changed; same-node handle changes surface as `sourceHandle`-only or
   * `targetHandle`-only patches (US-002).
   */
  onReconnectConnector?: (
    connectorId: string,
    patch: {
      source?: string;
      target?: string;
      sourceHandle?: string;
      targetHandle?: string;
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
 * Pick the closest TARGET handle ('t' top, 'l' left) on a node based on
 * cursor proximity. Distances are computed from the cursor to the centers of
 * the node's top edge and left edge — those are where the 't' and 'l'
 * handles render in shape/play/state node components. Used by the body-drop
 * fallback for new connections (US-014) so a release anywhere on the node
 * still produces a sensibly-anchored connector.
 */
const closestTargetHandleId = (
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): 't' | 'l' => {
  const topCenterX = rect.left + rect.width / 2;
  const topCenterY = rect.top;
  const leftCenterX = rect.left;
  const leftCenterY = rect.top + rect.height / 2;
  const distTop = Math.hypot(clientX - topCenterX, clientY - topCenterY);
  const distLeft = Math.hypot(clientX - leftCenterX, clientY - leftCenterY);
  return distTop <= distLeft ? 't' : 'l';
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
  selectedNodeId,
  onSelectNode,
  selectedConnectorId,
  onSelectConnector,
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
  const [drawShape, setDrawShape] = useState<ShapeKind | null>(null);
  // Mid-connect (or mid-reconnect) flag drives a wrapper class so handles on
  // every node stay visible until the gesture releases — the source has
  // already left hover and the user needs to discover drop targets without
  // hover-then-aim. Toggled via onConnectStart/End + onReconnectStart/End.
  const [connecting, setConnecting] = useState(false);
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

  useEffect(() => {
    if (!drawShape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitDrawMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawShape, exitDrawMode]);

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
        selected: merged.id === selectedNodeId,
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
    selectedNodeId,
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

  // selectedNodeId is the source of truth for the selection ring. React Flow
  // dispatches its own `select` changes during resize/drag (and sometimes on
  // dimension changes) that would briefly drop the ring. Mirror the prop into
  // a ref and re-pin selected:true on every change so the visual stays
  // anchored to the parent's selection state — no flicker mid-resize.
  const selectedIdRef = useRef(selectedNodeId);
  useEffect(() => {
    selectedIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => {
      const next = applyNodeChanges(changes, nds);
      const pinned = selectedIdRef.current;
      if (!pinned) return next;
      return next.map((n) => (n.id === pinned && !n.selected ? { ...n, selected: true } : n));
    });
  }, []);

  const reconnectableEdges = !!onReconnectConnector;
  const rfEdges = useMemo<Edge[]>(() => {
    const decorate = (c: Connector): Edge => {
      const adjacentRunning =
        statusFor(runs, c.source) === 'running' || statusFor(runs, c.target) === 'running';
      const isSelected = selectedConnectorId === c.id;
      const edge = connectorToEdge(c, adjacentRunning, isSelected);
      if (isSelected) edge.selected = true;
      // `reconnectable: true` enables the endpoint-drag gesture for the edge;
      // React Flow shows reconnect handles on hover. Wired only when the
      // parent provided an onReconnectConnector callback AND the edge is the
      // currently selected one — connectors are only movable while selected,
      // so unselected edges stay click-through and don't render endpoint
      // handles.
      const next: Edge = reconnectableEdges && isSelected ? { ...edge, reconnectable: true } : edge;
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
    selectedConnectorId,
    connectorOverrides,
    onConnectorLabelChange,
    reconnectableEdges,
  ]);

  // `connectSucceededRef` lets onConnectEnd skip the body-drop fallback when
  // onConnect already fired (precise handle drop). Same pattern as
  // `reconnectSucceededRef` below.
  const connectSucceededRef = useRef(false);
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!onCreateConnector) return;
      const { source, target, sourceHandle, targetHandle } = conn;
      if (!source || !target) return;
      // Reject same-node connections client-side — the schema would also
      // accept them but they're never useful (a node referencing itself).
      if (source === target) return;
      connectSucceededRef.current = true;
      onCreateConnector(source, target, {
        sourceHandle: sourceHandle ?? undefined,
        targetHandle: targetHandle ?? undefined,
      });
    },
    [onCreateConnector],
  );

  // Body-drop fallback for NEW connections (US-014). When the user drags from
  // a source handle and releases over a node's BODY (not precisely on one of
  // its four handles), React Flow's connectionRadius isn't enough to snap and
  // onConnect doesn't fire. We catch that here, hit-test elementsFromPoint
  // for the topmost `.react-flow__node`, pick the closest TARGET handle on
  // that node based on cursor proximity to the top/left edges, and call
  // onCreateConnector with both handles set so the persisted shape matches a
  // precise-handle drop. Mirrors `onReconnectEndCb` for existing edges.
  const onConnectEndCb = useCallback(
    (e: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      setConnecting(false);
      const succeeded = connectSucceededRef.current;
      connectSucceededRef.current = false;
      if (succeeded) return;
      if (!onCreateConnector) return;
      const fromNodeId = connectionState.fromNode?.id;
      const fromHandle = connectionState.fromHandle;
      if (!fromNodeId || !fromHandle) return;
      // Only support source→target body-drop today — the canonical drag
      // direction for new connections in this codebase. drag-from-target →
      // drop-on-source would mirror this with sourceHandle resolution.
      if (fromHandle.type !== 'source') return;
      const cursor = cursorFromConnectEvent(e);
      if (!cursor) return;
      const targetEl = nodeElAtPoint(cursor.clientX, cursor.clientY);
      if (!targetEl) return;
      const targetNodeId = targetEl.getAttribute('data-id');
      if (!targetNodeId || targetNodeId === fromNodeId) return;
      const rect = targetEl.getBoundingClientRect();
      const targetHandle = closestTargetHandleId(rect, cursor.clientX, cursor.clientY);
      const sourceHandle = typeof fromHandle.id === 'string' ? fromHandle.id : undefined;
      onCreateConnector(fromNodeId, targetNodeId, {
        sourceHandle,
        targetHandle,
      });
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
        sourceHandle?: string;
        targetHandle?: string;
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
      const succeeded = reconnectSucceededRef.current;
      reconnectSucceededRef.current = false;
      if (succeeded) return;
      if (!onReconnectConnector) return;
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
        onReconnectConnector(oldEdge.id, { source: droppedNodeId });
      } else {
        if (droppedNodeId === oldEdge.target) return;
        if (droppedNodeId === oldEdge.source) return;
        onReconnectConnector(oldEdge.id, { target: droppedNodeId });
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

  return (
    <div
      data-testid="anydemo-canvas"
      ref={wrapperRef}
      className="relative h-full w-full"
      style={drawShape ? { cursor: 'crosshair' } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drawingRef.current = false;
        drawStartRef.current = null;
        drawCurrentRef.current = null;
        setDrawStart(null);
        setDrawCurrent(null);
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
        onConnectStart={() => {
          setConnecting(true);
          connectSucceededRef.current = false;
        }}
        onConnectEnd={onConnectEndCb}
        onReconnect={onReconnectConnector ? onReconnect : undefined}
        onReconnectStart={() => {
          setConnecting(true);
          reconnectSucceededRef.current = false;
        }}
        onReconnectEnd={onReconnectEndCb}
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
        panOnDrag={!drawShape}
        zoomOnDoubleClick={false}
        onInit={(instance) => {
          rfInstanceRef.current = instance;
        }}
        onNodeClick={(_e, node) => onSelectNode(node.id)}
        onEdgeClick={(_e, edge) => onSelectConnector?.(edge.id)}
        onPaneClick={() => {
          // Skip pane-click selection clears during draw / drag / resize so
          // a stray release inside the pane doesn't drop the selection ring.
          if (drawShape || draggingRef.current || resizingRef.current) return;
          onSelectNode(null);
          onSelectConnector?.(null);
        }}
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
        <Background gap={12} size={0.6} />
        <Controls showInteractive={false} />
        {onCreateShapeNode ? (
          <Panel position="top-left">
            <CanvasToolbar activeShape={drawShape} onSelectShape={setDrawShape} />
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
