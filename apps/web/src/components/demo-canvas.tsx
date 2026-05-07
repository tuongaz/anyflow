import { CanvasToolbar } from '@/components/canvas-toolbar';
import { EditableEdge } from '@/components/edges/editable-edge';
import { PlayNode } from '@/components/nodes/play-node';
import { ShapeNode } from '@/components/nodes/shape-node';
import { StateNode } from '@/components/nodes/state-node';
import type { NodeStatus } from '@/components/nodes/status-pill';
import type { NodeRuns } from '@/hooks/use-node-runs';
import type { OverrideMap } from '@/hooks/use-pending-overrides';
import type { Connector, DemoNode, ShapeKind } from '@/lib/api';
import { connectorToEdge } from '@/lib/connector-to-edge';
import { cn } from '@/lib/utils';
import {
  Background,
  type Connection,
  Controls,
  type Edge,
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
   * parent never sees them.
   */
  onCreateConnector?: (source: string, target: string) => void;
  /**
   * Reattach an existing connector's source or target to a different node.
   * Wired enables React Flow's edge reconnect gesture: drag an edge endpoint
   * onto another handle to call this with the new source/target. The patch
   * only includes the field that changed.
   */
  onReconnectConnector?: (connectorId: string, patch: { source?: string; target?: string }) => void;
}

const MIN_DRAW_SIZE = 8;

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
      const width = maxX - minX;
      const height = maxY - minY;
      // Tiny drags (or pure clicks) don't commit — they'd produce a degenerate
      // node that's invisible until the user resizes it.
      if (width < MIN_DRAW_SIZE || height < MIN_DRAW_SIZE) return;
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

  const sourceNodes = useMemo<Node[]>(
    () =>
      nodes.map((n) => {
        const merged = mergeNodeOverride(n, nodeOverrides?.[n.id]);
        const node: Node = {
          id: merged.id,
          type: merged.type,
          position: merged.position,
          data: {
            ...merged.data,
            status: dataStatusFor(runs, n.id),
            onPlay: onPlayNode,
            onResize: onNodeResize,
            setResizing,
            onLabelChange: onNodeLabelChange,
            onDescriptionChange: merged.type === 'shapeNode' ? undefined : onNodeDescriptionChange,
          },
          selected: n.id === selectedNodeId,
        };
        // Pass explicit width/height to the React Flow node wrapper when set
        // in data. NodeResizer dispatches dimension changes that update these
        // during a gesture; we only persist (and hence sync them back into
        // data) on resize-stop.
        if (merged.data.width !== undefined) node.width = merged.data.width;
        if (merged.data.height !== undefined) node.height = merged.data.height;
        return node;
      }),
    [
      nodes,
      selectedNodeId,
      runs,
      onPlayNode,
      onNodeResize,
      setResizing,
      nodeOverrides,
      onNodeLabelChange,
      onNodeDescriptionChange,
    ],
  );

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
      const edge = connectorToEdge(c, adjacentRunning);
      if (selectedConnectorId === c.id) edge.selected = true;
      // `reconnectable: true` enables the endpoint-drag gesture for the edge;
      // React Flow shows reconnect handles on hover. Wired only when the
      // parent provided an onReconnectConnector callback.
      const next: Edge = reconnectableEdges ? { ...edge, reconnectable: true } : edge;
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

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!onCreateConnector) return;
      const { source, target } = conn;
      if (!source || !target) return;
      // Reject same-node connections client-side — the schema would also
      // accept them but they're never useful (a node referencing itself).
      if (source === target) return;
      onCreateConnector(source, target);
    },
    [onCreateConnector],
  );

  // Drag an edge endpoint onto another handle to reattach it. React Flow
  // computes the new connection from the gesture; we forward the diff
  // (source or target) to the parent for persistence. The parent applies
  // an optimistic override so the edge snaps immediately; the SSE echo of
  // the file rewrite reconciles any drift.
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (!onReconnectConnector) return;
      const { source, target } = newConnection;
      if (!source || !target || source === target) return;
      const patch: { source?: string; target?: string } = {};
      if (source !== oldEdge.source) patch.source = source;
      if (target !== oldEdge.target) patch.target = target;
      if (!patch.source && !patch.target) return;
      onReconnectConnector(oldEdge.id, patch);
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
        onConnect={onConnect}
        onReconnect={onReconnectConnector ? onReconnect : undefined}
        // Generous connection radius so the user can release a connect or
        // reconnect drag near a handle without pixel-perfect aim. React Flow
        // snaps to the closest handle within this radius.
        connectionRadius={32}
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
      >
        <Background gap={12} size={0.6} />
        <Controls showInteractive={false} />
        {onCreateShapeNode ? (
          <Panel position="bottom-center">
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
    </div>
  );
}
