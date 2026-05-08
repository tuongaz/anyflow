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
  getBezierPath,
  getSmoothStepPath,
  useInternalNode,
} from '@xyflow/react';
import { useState } from 'react';

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
  /**
   * US-025: floating endpoints when !== false (true OR absent). When false
   * (user-pinned via a precise handle drop), React Flow's stored handle
   * coords drive the endpoint instead.
   */
  sourceHandleAutoPicked?: boolean;
  /** US-025: same as sourceHandleAutoPicked but for the target endpoint. */
  targetHandleAutoPicked?: boolean;
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
