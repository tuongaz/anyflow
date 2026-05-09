import { InlineEdit } from '@/components/inline-edit';
import type { ConnectorPath } from '@/lib/api';
import { type Endpoint, type Side, resolveEdgeEndpoints } from '@/lib/floating-edge-geometry';
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
} from '@xyflow/react';
import { useEffect, useState } from 'react';

// Smoothstep corner rounding — matches typical "zigzag" diagrams without
// looking jagged. (US-017)
const SMOOTHSTEP_BORDER_RADIUS = 8;

// US-011 / US-024: shift in flow units applied to the EdgeAnchor circle's
// cx/cy (mirrors xyflow's `shiftX/shiftY(centerX, radius, position)` with
// radius = the `reconnectRadius` prop on <ReactFlow>, which we set to 10 in
// demo-canvas.tsx — matching the 20px visible diameter from the shared
// --anydemo-handle-size token). Keep these in lock-step with that prop so
// the visible reconnect dot's center sits half a diameter outside the
// floating endpoint — same offset xyflow uses for its (default) anchor
// placement.
const RECONNECT_ANCHOR_SHIFT = 10;
const shiftAnchorForSide = (
  baseX: number,
  baseY: number,
  side: Side,
): { cx: number; cy: number } => {
  switch (side) {
    case 'top':
      return { cx: baseX, cy: baseY - RECONNECT_ANCHOR_SHIFT };
    case 'bottom':
      return { cx: baseX, cy: baseY + RECONNECT_ANCHOR_SHIFT };
    case 'left':
      return { cx: baseX - RECONNECT_ANCHOR_SHIFT, cy: baseY };
    case 'right':
      return { cx: baseX + RECONNECT_ANCHOR_SHIFT, cy: baseY };
  }
};

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
  /**
   * US-025: floating endpoints when !== false (true OR absent). When false
   * (user-pinned via a precise handle drop), React Flow's stored handle
   * coords drive the endpoint instead.
   */
  sourceHandleAutoPicked?: boolean;
  /** US-025: same as sourceHandleAutoPicked but for the target endpoint. */
  targetHandleAutoPicked?: boolean;
  /**
   * US-024: when true, render visible white-fill / grey-border endpoint
   * dots in a <ViewportPortal> above every node and edge. Mirrors the
   * `reconnectable` flag on the edge itself (set by demo-canvas.tsx for
   * the sole-selected connector).
   */
  reconnectable?: boolean;
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

  // US-011: xyflow's EdgeAnchor circles (rendered as siblings to BaseEdge
  // when `reconnectable: true`) use xyflow's own sourceX/sourceY/sourcePosition
  // — which point at xyflow's first-handle for floating edges, NOT at the
  // body-perimeter intersection we render the path through. To keep the
  // visible reconnect dots glued to the actual edge endpoints, override
  // `cx`/`cy` on the EdgeAnchor circles after each render so they sit at
  // (endpoints.source ± shift). For pinned edges the floating-endpoint
  // equals xyflow's handle position so this is a no-op; for floating edges
  // it's the difference between "dot at body midpoint" and "dot where the
  // edge actually visually ends". Imperative because xyflow renders the
  // EdgeAnchor in a sibling render path we can't intercept declaratively.
  const sourceSide = endpoints.source.side;
  const targetSide = endpoints.target.side;
  useEffect(() => {
    const wrapper = document.querySelector(
      `.react-flow__edge[data-id="${CSS.escape(id)}"]`,
    ) as SVGGElement | null;
    if (!wrapper) return;
    const sourceAnchor = wrapper.querySelector<SVGCircleElement>('.react-flow__edgeupdater-source');
    const targetAnchor = wrapper.querySelector<SVGCircleElement>('.react-flow__edgeupdater-target');
    if (sourceAnchor) {
      const { cx, cy } = shiftAnchorForSide(sX, sY, sourceSide);
      sourceAnchor.setAttribute('cx', String(cx));
      sourceAnchor.setAttribute('cy', String(cy));
    }
    if (targetAnchor) {
      const { cx, cy } = shiftAnchorForSide(tX, tY, targetSide);
      targetAnchor.setAttribute('cx', String(cx));
      targetAnchor.setAttribute('cy', String(cy));
    }
  }, [id, sX, sY, tX, tY, sourceSide, targetSide]);

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

  // US-024: when this edge is reconnectable (sole-selected connector), render
  // visible white-fill / grey-border endpoint dots in a <ViewportPortal> so
  // they layer above every node and edge in the canvas — including any
  // sibling node that overlaps the floating endpoint. The DOM-level SVG
  // anchor circles (`.react-flow__edgeupdater`) stay in place underneath as
  // transparent hit targets for xyflow's reconnect-drag machinery.
  const showEndpointDots = data?.reconnectable === true;
  const sourceDot = showEndpointDots ? shiftAnchorForSide(sX, sY, sourceSide) : null;
  const targetDot = showEndpointDots ? shiftAnchorForSide(tX, tY, targetSide) : null;

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
      {showEndpointDots && sourceDot && targetDot ? (
        <ViewportPortal>
          <div
            className="anydemo-connector-endpoint-dot"
            style={{
              transform: `translate(-50%, -50%) translate(${sourceDot.cx}px, ${sourceDot.cy}px)`,
            }}
          />
          <div
            className="anydemo-connector-endpoint-dot"
            style={{
              transform: `translate(-50%, -50%) translate(${targetDot.cx}px, ${targetDot.cy}px)`,
            }}
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
              className="text-[11px]"
              placeholder="Label"
            />
          ) : labelText ? (
            <button
              type="button"
              className={cn(
                'rounded border border-border/40 bg-card px-1.5 py-0.5 text-[11px] text-foreground shadow-sm',
                editable ? 'hover:bg-muted/60' : '',
              )}
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
              className="rounded-full border border-dashed border-muted-foreground/40 bg-card/60 px-1 text-[10px] text-muted-foreground/60 opacity-0 transition-opacity hover:opacity-100 group-hover/canvas:opacity-50"
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
