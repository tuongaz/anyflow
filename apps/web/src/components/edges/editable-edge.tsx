import { InlineEdit } from '@/components/inline-edit';
import type { ConnectorPath, EdgePin } from '@/lib/api';
import {
  type Endpoint,
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
   * pointer-up at the end of a pin-drag gesture; the parent is responsible
   * for the optimistic override + PATCH + undo entry.
   */
  onPinEndpoint?: (id: string, kind: 'source' | 'target', pin: Pin) => void;
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
  const { screenToFlowPosition } = useReactFlow();

  // US-007: local preview pins, set per-frame while the user is dragging the
  // endpoint dot. Override `data.sourcePin` / `data.targetPin` for the
  // duration of the gesture so the live edge slides along the perimeter
  // without round-tripping through the parent + PATCH on every mousemove.
  // On pointer-up we clear the local state and the parent's optimistic
  // override takes over until the SSE echo of the PATCH arrives.
  const [dragPin, setDragPin] = useState<{ kind: 'source' | 'target'; pin: Pin } | null>(null);

  const dataSourcePin = data?.sourcePin;
  const dataTargetPin = data?.targetPin;
  const effectiveSourcePin =
    dragPin?.kind === 'source' ? dragPin.pin : (dataSourcePin as Pin | undefined);
  const effectiveTargetPin =
    dragPin?.kind === 'target' ? dragPin.pin : (dataTargetPin as Pin | undefined);

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
    sourceNode
      ? {
          box: {
            x: sourceNode.internals.positionAbsolute.x,
            y: sourceNode.internals.positionAbsolute.y,
            w: sourceNode.measured.width ?? sourceNode.width ?? 0,
            h: sourceNode.measured.height ?? sourceNode.height ?? 0,
          },
          autoPicked: data?.sourceHandleAutoPicked,
          pin: effectiveSourcePin,
          fallback: sourceFallback,
        }
      : null,
    targetNode
      ? {
          box: {
            x: targetNode.internals.positionAbsolute.x,
            y: targetNode.internals.positionAbsolute.y,
            w: targetNode.measured.width ?? targetNode.width ?? 0,
            h: targetNode.measured.height ?? targetNode.height ?? 0,
          },
          autoPicked: data?.targetHandleAutoPicked,
          pin: effectiveTargetPin,
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
  const onEndpointContextMenu = data?.onEndpointContextMenu;

  // US-007: per-endpoint pin-drag handler. Captures the source/target node's
  // current bbox on pointer-down (re-read on every mousemove so the pin
  // tracks a node that drags concurrently), projects the cursor onto the
  // perimeter, and updates `dragPin` every frame. On pointer-up the final
  // pin is persisted via `data.onPinEndpoint`; the local state is cleared
  // so the parent's optimistic override drives the rendered position until
  // the SSE echo arrives.
  //
  // The handler is bound to the visible dot's `onMouseDown`. We use document-
  // level mousemove/mouseup so the gesture survives the cursor leaving the
  // dot's bbox (the user is dragging an endpoint, not the dot itself).
  // `latestPinRef` carries the per-frame pin out of the move callback into
  // mouseup since closures over state would read the stale initial value.
  const latestPinRef = useRef<Pin | null>(null);
  const onPinDragStart = useCallback(
    (kind: 'source' | 'target') => (e: ReactMouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (!onPinEndpoint) return;
      const node = kind === 'source' ? sourceNode : targetNode;
      if (!node) return;
      e.preventDefault();
      e.stopPropagation();
      latestPinRef.current = null;

      const readBox = () => ({
        x: node.internals.positionAbsolute.x,
        y: node.internals.positionAbsolute.y,
        w: node.measured.width ?? node.width ?? 0,
        h: node.measured.height ?? node.height ?? 0,
      });

      const onMove = (ev: MouseEvent) => {
        const flow = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        const pin = projectCursorToPerimeter(readBox(), flow);
        latestPinRef.current = pin;
        setDragPin({ kind, pin });
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const finalPin = latestPinRef.current;
        latestPinRef.current = null;
        setDragPin(null);
        if (finalPin) onPinEndpoint(id, kind, finalPin);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [id, onPinEndpoint, sourceNode, targetNode, screenToFlowPosition],
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
            data-dragging={dragPin?.kind === 'source' ? 'true' : 'false'}
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
            data-dragging={dragPin?.kind === 'target' ? 'true' : 'false'}
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
