import { InlineEdit } from '@/components/inline-edit';
import type { ConnectorPath, EdgePin } from '@/lib/api';
import {
  type Endpoint,
  type FloatingRect,
  type Pin,
  type Side,
  projectCursorToPerimeter,
  resolveEdgeEndpoints,
} from '@/lib/floating-edge-geometry';
import { cn } from '@/lib/utils';
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Position,
  ViewportPortal,
  getBezierPath,
  getSmoothStepPath,
  useInternalNode,
  useReactFlow,
} from '@xyflow/react';
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

// Smoothstep corner rounding — matches typical "zigzag" diagrams without
// looking jagged. (US-017)
const SMOOTHSTEP_BORDER_RADIUS = 8;

// Map our floating-edge-geometry side strings (matching React Flow's
// Position enum values) to the actual Position enum members so the path
// helpers receive the correct enum identity. The Position enum's values
// are also 'top' | 'right' | 'bottom' | 'left' — but TypeScript doesn't
// recognize the string-literal-to-enum coercion, so the lookup table
// makes the typing explicit.
const POSITION_BY_SIDE: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

const sideFromPosition = (p: Position): Side => {
  switch (p) {
    case Position.Top:
      return 'top';
    case Position.Right:
      return 'right';
    case Position.Bottom:
      return 'bottom';
    case Position.Left:
      return 'left';
  }
};

export type EditableEdgeData = {
  /** Persist a new label (PATCH /connectors/:id { label }). */
  onLabelChange?: (id: string, label: string) => void;
  /** Path geometry — 'curve' (default bezier) or 'step' (smoothstep). */
  path?: ConnectorPath;
  /** US-018: per-connector label font size in px (undefined → 11px default). */
  fontSize?: number;
  /**
   * US-018: register a stable handle that enters inline label edit mode.
   * Called once on mount with `(id, enter) => unregister`. demo-canvas calls
   * the registered `enter()` from its onEdgeDoubleClick callback so a
   * double-click anywhere on the edge body opens the editor — not just on
   * the existing label button.
   */
  registerEditHandle?: (id: string, enter: () => void) => () => void;
  /**
   * US-025: floating endpoints when !== false (true OR absent). When false
   * (user-pinned via a precise handle drop), React Flow's stored handle
   * coords drive the endpoint instead.
   */
  sourceHandleAutoPicked?: boolean;
  /** US-025: same as sourceHandleAutoPicked but for the target endpoint. */
  targetHandleAutoPicked?: boolean;
  /**
   * US-007: explicit perimeter pin for the source endpoint. When set,
   * resolveEdgeEndpoints anchors the source endpoint at `(side, t)` on the
   * source node's bbox and ignores both floating and auto-pick.
   */
  sourcePin?: EdgePin;
  /** US-007: same as sourcePin but for the target endpoint. */
  targetPin?: EdgePin;
  /**
   * US-024 / US-007: when true, render the visible endpoint dots above
   * every node and edge in the canvas. Mirrors the `reconnectable` flag on
   * the edge itself (set by demo-canvas.tsx for the sole-selected connector).
   */
  reconnectable?: boolean;
  /**
   * US-007: persist a new perimeter pin for the named endpoint. Called on
   * pointer-up at the end of a pin-drag gesture when the endpoint was
   * released over the SAME node it was already attached to. The parent is
   * responsible for the optimistic override + PATCH + undo entry.
   */
  onPinEndpoint?: (id: string, kind: 'source' | 'target', pin: Pin) => void;
  /**
   * Reattach the named endpoint to a different node AND pin it on that
   * node's perimeter. Called on pointer-up at the end of a pin-drag gesture
   * when the cursor was released over a node OTHER than the one the
   * endpoint was attached to. The parent is responsible for rejecting
   * invalid targets (text shapes, same-node-as-other-endpoint), the
   * optimistic override, PATCH (source/target + handle clear + autoPicked
   * + pin in one go), and the undo entry.
   */
  onReconnectEndpointToNode?: (
    id: string,
    kind: 'source' | 'target',
    newNodeId: string,
    pin: Pin,
  ) => void;
  /**
   * US-007: open the endpoint context menu (Unpin item) at the cursor.
   * `pinned` lets the canvas gate the Unpin item's visibility without
   * re-reading edge state. Right-click on the dot fires this.
   */
  onEndpointContextMenu?: (
    id: string,
    kind: 'source' | 'target',
    pinned: boolean,
    clientX: number,
    clientY: number,
  ) => void;
} & Record<string, unknown>;

export type EditableEdgeType = Edge<EditableEdgeData, 'editableEdge'>;

/**
 * Custom React Flow edge rendered as a smooth bezier curve so connectors flow
 * between handles instead of stepping at right angles. Doubles up as an
 * inline-editor for the connector label via double-click.
 *
 * The label is rendered through `EdgeLabelRenderer` (an HTML overlay portal)
 * rather than the SVG-native `<text>` element so we can swap it for an
 * `<input>` in place. The `nodrag nopan nowheel` classes opt the overlay out
 * of React Flow's pointer/wheel capture so typing/clicking works normally.
 *
 * US-025: when `data.sourceHandleAutoPicked !== false` (true OR undefined)
 * the source endpoint floats — we read the source node's live geometry via
 * `useInternalNode` and place the endpoint at the perimeter intersection of
 * the line through the two node centers, ignoring React Flow's stored
 * handle coords. When `=== false`, we use the React-Flow-supplied props
 * unchanged so a user-pinned handle stays put. Same logic for target.
 *
 * US-007: when `data.sourcePin` / `data.targetPin` is set, the endpoint is
 * anchored to a specific perimeter point that follows the node through
 * moves and resizes. Dragging the visible portal dot clamps the cursor onto
 * the perimeter and updates the local preview every frame; pointer-up
 * persists the new pin via `data.onPinEndpoint`. Right-clicking a pinned
 * dot opens the canvas's Unpin context menu via `data.onEndpointContextMenu`.
 */
export function EditableEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
  markerStart,
  interactionWidth,
  data,
}: EdgeProps<EditableEdgeType>) {
  const [editing, setEditing] = useState(false);
  // useInternalNode subscribes the edge to changes on each node — including
  // position and dimensions — so a drag visibly slides the floating
  // endpoint along the perimeter in real time without any rerouter machinery.
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const { screenToFlowPosition, getInternalNode } = useReactFlow();

  // US-007: local preview pins, set per-frame while the user is dragging the
  // endpoint dot. Override `data.sourcePin` / `data.targetPin` for the
  // duration of the gesture so the live edge slides along the perimeter
  // without round-tripping through the parent + PATCH on every mousemove.
  // On pointer-up we clear the local state and the parent's optimistic
  // override takes over until the SSE echo of the PATCH arrives.
  //
  // `nodeId` is the node the preview should anchor against. While the user
  // drags the cursor across nodes it switches to the hovered node so the
  // edge visibly reattaches in real time; on pointer-up over a foreign node
  // we dispatch `onReconnectEndpointToNode` rather than `onPinEndpoint`.
  const [dragPreview, setDragPreview] = useState<{
    kind: 'source' | 'target';
    nodeId: string;
    pin: Pin;
  } | null>(null);

  const dataSourcePin = data?.sourcePin;
  const dataTargetPin = data?.targetPin;
  // Live preview pin only applies when the drag is still anchored on the
  // edge's own endpoint node — a drag onto a different node is rendered by
  // swapping the box below, not by overriding the pin against the original
  // box (which would draw the preview on the wrong rectangle).
  const sourceDragOnSelf = dragPreview?.kind === 'source' && dragPreview.nodeId === source;
  const targetDragOnSelf = dragPreview?.kind === 'target' && dragPreview.nodeId === target;
  const effectiveSourcePin = sourceDragOnSelf
    ? dragPreview.pin
    : (dataSourcePin as Pin | undefined);
  const effectiveTargetPin = targetDragOnSelf
    ? dragPreview.pin
    : (dataTargetPin as Pin | undefined);

  // Live preview against a different node: swap the source/target node used
  // for box geometry to the hovered one, and feed the preview pin through.
  // resolveEdgeEndpoints prefers `pin` over autoPicked/floating, so the dot
  // tracks the cursor against the new node's perimeter.
  const sourceForeignDrag =
    dragPreview?.kind === 'source' && dragPreview.nodeId !== source ? dragPreview : null;
  const targetForeignDrag =
    dragPreview?.kind === 'target' && dragPreview.nodeId !== target ? dragPreview : null;
  const sourceForeignNode = sourceForeignDrag ? getInternalNode(sourceForeignDrag.nodeId) : null;
  const targetForeignNode = targetForeignDrag ? getInternalNode(targetForeignDrag.nodeId) : null;
  const sourceRenderNode = sourceForeignNode ?? sourceNode;
  const targetRenderNode = targetForeignNode ?? targetNode;

  const sourceFallback: Endpoint = {
    x: sourceX,
    y: sourceY,
    side: sideFromPosition(sourcePosition),
  };
  const targetFallback: Endpoint = {
    x: targetX,
    y: targetY,
    side: sideFromPosition(targetPosition),
  };
  const endpoints = resolveEdgeEndpoints(
    sourceRenderNode
      ? {
          box: {
            x: sourceRenderNode.internals.positionAbsolute.x,
            y: sourceRenderNode.internals.positionAbsolute.y,
            w: sourceRenderNode.measured.width ?? sourceRenderNode.width ?? 0,
            h: sourceRenderNode.measured.height ?? sourceRenderNode.height ?? 0,
          },
          autoPicked: data?.sourceHandleAutoPicked,
          pin: sourceForeignDrag ? sourceForeignDrag.pin : effectiveSourcePin,
          fallback: sourceFallback,
        }
      : null,
    targetRenderNode
      ? {
          box: {
            x: targetRenderNode.internals.positionAbsolute.x,
            y: targetRenderNode.internals.positionAbsolute.y,
            w: targetRenderNode.measured.width ?? targetRenderNode.width ?? 0,
            h: targetRenderNode.measured.height ?? targetRenderNode.height ?? 0,
          },
          autoPicked: data?.targetHandleAutoPicked,
          pin: targetForeignDrag ? targetForeignDrag.pin : effectiveTargetPin,
          fallback: targetFallback,
        }
      : null,
  );

  const sX = endpoints.source.x;
  const sY = endpoints.source.y;
  const sPos = POSITION_BY_SIDE[endpoints.source.side];
  const tX = endpoints.target.x;
  const tY = endpoints.target.y;
  const tPos = POSITION_BY_SIDE[endpoints.target.side];

  // 'step' renders as a smoothstep (right-angle / zigzag); anything else falls
  // back to today's smooth bezier. Both branches return the same tuple shape so
  // the EdgeLabelRenderer call site is unchanged.
  const [edgePath, labelX, labelY] =
    data?.path === 'step'
      ? getSmoothStepPath({
          sourceX: sX,
          sourceY: sY,
          sourcePosition: sPos,
          targetX: tX,
          targetY: tY,
          targetPosition: tPos,
          borderRadius: SMOOTHSTEP_BORDER_RADIUS,
        })
      : getBezierPath({
          sourceX: sX,
          sourceY: sY,
          sourcePosition: sPos,
          targetX: tX,
          targetY: tY,
          targetPosition: tPos,
        });
  const onLabelChange = data?.onLabelChange;
  const labelText = typeof label === 'string' ? label : '';
  const editable = !!onLabelChange;
  const fontSize = data?.fontSize;
  // Inline style overrides text-[11px] only when fontSize is set, so existing
  // unstyled connectors continue to render identically (back-compat).
  const fontSizeStyle = typeof fontSize === 'number' ? { fontSize: `${fontSize}px` } : undefined;

  // US-018: register an external entry point to enter edit mode. demo-canvas
  // wires this via onEdgeDoubleClick so a dblclick anywhere on the edge body
  // (not just the label button) opens the editor.
  const registerEditHandle = data?.registerEditHandle;
  useEffect(() => {
    if (!registerEditHandle || !editable) return;
    return registerEditHandle(id, () => setEditing(true));
  }, [id, registerEditHandle, editable]);

  // US-024 / US-007: only render the visible endpoint dots when this edge is
  // reconnectable (sole-selected). Outside that mode, the edge has no
  // pin-drag affordance — the dots are how the user discovers and triggers
  // the gesture.
  const showEndpointDots = data?.reconnectable === true;
  const onPinEndpoint = data?.onPinEndpoint;
  const onReconnectEndpointToNode = data?.onReconnectEndpointToNode;
  const onEndpointContextMenu = data?.onEndpointContextMenu;

  // US-007 / endpoint reattach: per-endpoint pin-drag handler. On each
  // mousemove we hit-test the cursor: if it lies over a node OTHER than the
  // one this endpoint is attached to (and not the OTHER endpoint's node —
  // that would create a self-loop), we project against the hovered node's
  // bbox so the live edge reattaches to it. Releasing then either pins
  // (same node) or reattaches+pins (different node).
  //
  // The handler is bound to the visible dot's `onMouseDown`. We use document-
  // level mousemove/mouseup so the gesture survives the cursor leaving the
  // dot's bbox (the user is dragging an endpoint, not the dot itself).
  // `latestRef` carries the per-frame state out of the move callback into
  // mouseup since closures over state would read the stale initial value.
  const latestRef = useRef<{ nodeId: string; pin: Pin } | null>(null);
  const onPinDragStart = useCallback(
    (kind: 'source' | 'target') => (e: ReactMouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // Either callback enables the drag — same-node releases need
      // onPinEndpoint, cross-node releases need onReconnectEndpointToNode.
      // Without either the drag is inert.
      if (!onPinEndpoint && !onReconnectEndpointToNode) return;
      const ownNodeId = kind === 'source' ? source : target;
      const otherEndpointNodeId = kind === 'source' ? target : source;
      const ownNode = getInternalNode(ownNodeId);
      if (!ownNode) return;
      e.preventDefault();
      e.stopPropagation();
      latestRef.current = null;

      const boxFromNode = (n: ReturnType<typeof getInternalNode>): FloatingRect | null => {
        if (!n) return null;
        return {
          x: n.internals.positionAbsolute.x,
          y: n.internals.positionAbsolute.y,
          w: n.measured.width ?? n.width ?? 0,
          h: n.measured.height ?? n.height ?? 0,
        };
      };

      // Walk elementsFromPoint and return the topmost `.react-flow__node`
      // wrapper id under the cursor, or null. The endpoint dot itself isn't
      // inside a node (it's portal-rendered in the viewport), so the dot
      // won't shadow the node beneath the cursor.
      const nodeIdAt = (clientX: number, clientY: number): string | null => {
        const stack = document.elementsFromPoint(clientX, clientY);
        for (const el of stack) {
          const nodeEl = (el as HTMLElement).closest?.('.react-flow__node');
          if (nodeEl) return nodeEl.getAttribute('data-id');
        }
        return null;
      };

      const onMove = (ev: MouseEvent) => {
        const flow = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        const hoveredId = nodeIdAt(ev.clientX, ev.clientY);
        // Reattach only when the hovered node is a different node AND not
        // the other endpoint's node (rejecting same-node-as-other-endpoint
        // here avoids drawing a self-loop preview; the parent re-checks on
        // commit). Otherwise stay on the own node and treat the gesture as
        // a perimeter-pin slide.
        const targetNodeId =
          hoveredId && hoveredId !== ownNodeId && hoveredId !== otherEndpointNodeId
            ? hoveredId
            : ownNodeId;
        const hoveredNode = targetNodeId === ownNodeId ? ownNode : getInternalNode(targetNodeId);
        const box = boxFromNode(hoveredNode);
        if (!box) return;
        const pin = projectCursorToPerimeter(box, flow);
        latestRef.current = { nodeId: targetNodeId, pin };
        setDragPreview({ kind, nodeId: targetNodeId, pin });
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const final = latestRef.current;
        latestRef.current = null;
        setDragPreview(null);
        if (!final) return;
        if (final.nodeId === ownNodeId) {
          onPinEndpoint?.(id, kind, final.pin);
        } else {
          onReconnectEndpointToNode?.(id, kind, final.nodeId, final.pin);
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [
      id,
      source,
      target,
      onPinEndpoint,
      onReconnectEndpointToNode,
      getInternalNode,
      screenToFlowPosition,
    ],
  );

  const onDotContextMenu = useCallback(
    (kind: 'source' | 'target', pinned: boolean) => (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!onEndpointContextMenu) return;
      e.preventDefault();
      e.stopPropagation();
      onEndpointContextMenu(id, kind, pinned, e.clientX, e.clientY);
    },
    [id, onEndpointContextMenu],
  );

  const sourcePinned = effectiveSourcePin !== undefined;
  const targetPinned = effectiveTargetPin !== undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={interactionWidth}
      />
      {showEndpointDots ? (
        <ViewportPortal>
          <div
            data-testid={`edge-endpoint-source-${id}`}
            data-pinned={sourcePinned ? 'true' : 'false'}
            data-dragging={dragPreview?.kind === 'source' ? 'true' : 'false'}
            className="anydemo-connector-endpoint-dot"
            style={{
              transform: `translate(-50%, -50%) translate(${sX}px, ${sY}px)`,
            }}
            onMouseDown={onPinDragStart('source')}
            onContextMenu={onDotContextMenu('source', sourcePinned)}
          />
          <div
            data-testid={`edge-endpoint-target-${id}`}
            data-pinned={targetPinned ? 'true' : 'false'}
            data-dragging={dragPreview?.kind === 'target' ? 'true' : 'false'}
            className="anydemo-connector-endpoint-dot"
            style={{
              transform: `translate(-50%, -50%) translate(${tX}px, ${tY}px)`,
            }}
            onMouseDown={onPinDragStart('target')}
            onContextMenu={onDotContextMenu('target', targetPinned)}
          />
        </ViewportPortal>
      ) : null}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan nowheel pointer-events-auto absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {editing && editable ? (
            <InlineEdit
              initialValue={labelText}
              field="connector-label"
              onCommit={(v) => onLabelChange?.(id, v)}
              onExit={() => setEditing(false)}
              // US-018: opaque background masks the SVG path behind the editor
              // so the line doesn't bleed through the editing affordance.
              // bg-background (theme-aware) wins over the prior bg-card (which
              // is semi-transparent and let the line show through).
              className="rounded border border-border/40 bg-background px-1.5 py-0.5 text-[11px] text-foreground shadow-sm"
              style={fontSizeStyle}
              placeholder="Label"
            />
          ) : labelText ? (
            <button
              type="button"
              className={cn(
                // US-018: bg-background (opaque) masks the connector line beneath
                // the label so the path doesn't bleed through the text.
                'rounded border border-border/40 bg-background px-1.5 py-0.5 text-[11px] text-foreground shadow-sm',
                editable ? 'hover:bg-muted/60' : '',
              )}
              style={fontSizeStyle}
              onDoubleClick={
                editable
                  ? (e) => {
                      e.stopPropagation();
                      setEditing(true);
                    }
                  : undefined
              }
            >
              {labelText}
            </button>
          ) : editable ? (
            <button
              type="button"
              aria-label="Add connector label"
              // US-018: bg-background (opaque) when visible so the '+' affordance
              // masks the connector line beneath it.
              className="rounded-full border border-dashed border-muted-foreground/40 bg-background px-1 text-[10px] text-muted-foreground/60 opacity-0 transition-opacity hover:opacity-100 group-hover/canvas:opacity-50"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
            >
              +
            </button>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
