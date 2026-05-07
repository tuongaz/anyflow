import { InlineEdit } from '@/components/inline-edit';
import { cn } from '@/lib/utils';
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
} from '@xyflow/react';
import { useState } from 'react';

export type EditableEdgeData = {
  /** Persist a new label (PATCH /connectors/:id { label }). */
  onLabelChange?: (id: string, label: string) => void;
} & Record<string, unknown>;

export type EditableEdgeType = Edge<EditableEdgeData, 'editableEdge'>;

/**
 * Custom React Flow edge that mirrors the built-in smoothstep visuals while
 * letting the user inline-edit the connector label via double-click.
 *
 * The label is rendered through `EdgeLabelRenderer` (an HTML overlay portal)
 * rather than the SVG-native `<text>` element so we can swap it for an
 * `<input>` in place. The `nodrag nopan nowheel` classes opt the overlay out
 * of React Flow's pointer/wheel capture so typing/clicking works normally.
 */
export function EditableEdge({
  id,
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
  data,
}: EdgeProps<EditableEdgeType>) {
  const [editing, setEditing] = useState(false);
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
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
