import { InlineEdit } from '@/components/inline-edit';
import { ResizeControls } from '@/components/nodes/resize-controls';
import type { ShapeKind, ShapeNodeData } from '@/lib/api';
import { colorTokenStyle } from '@/lib/color-tokens';
import { cn } from '@/lib/utils';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, useState } from 'react';

export type ShapeNodeRuntimeData = ShapeNodeData & {
  onResize?: (nodeId: string, dims: { width: number; height: number }) => void;
  setResizing?: (on: boolean) => void;
  /** Persist a new label (PATCH /nodes/:id { label }). Optional for shape nodes. */
  onLabelChange?: (nodeId: string, label: string) => void;
} & Record<string, unknown>;
export type ShapeNodeType = Node<ShapeNodeRuntimeData, 'shapeNode'>;

export const SHAPE_DEFAULT_SIZE: Record<ShapeKind, { width: number; height: number }> = {
  rectangle: { width: 200, height: 120 },
  ellipse: { width: 200, height: 120 },
  sticky: { width: 180, height: 180 },
  text: { width: 160, height: 40 },
};

// `text` deliberately omits border + background so the shape reads as a free
// floating annotation (no chrome). Selection still draws an outline (handled
// below by the `selected` branch on `colorStyle`).
const SHAPE_CLASS: Record<ShapeKind, string> = {
  rectangle: 'rounded-lg border-[3px] bg-transparent',
  ellipse: 'rounded-full border-[3px] bg-transparent',
  sticky: 'rounded-md border-[3px] shadow-md -rotate-1',
  text: 'bg-transparent',
};

const HANDLE_CLASS =
  '!h-2 !w-2 !bg-muted-foreground opacity-0 transition-opacity group-hover:opacity-100';

export function ShapeNode({ id, data, selected }: NodeProps<ShapeNodeType>) {
  const shape = data.shape;
  const size = SHAPE_DEFAULT_SIZE[shape];
  const [isResizing, setIsResizing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const labelEditable = !!data.onLabelChange;
  // While resizing OR once data.width/height are set, the React Flow wrapper
  // owns the dimensions; the inner fills via h-full w-full. Before any resize,
  // we still need an explicit size so the wrapper auto-sizes to it.
  const sized = isResizing || data.width !== undefined || data.height !== undefined;

  // Text shapes are chromeless: no border, no background. Selection still
  // needs a visible affordance — handled below by the unified outer-rect
  // outline so text and chromed shapes share the exact same selection chrome.
  const isText = shape === 'text';
  // borderColor: always pick from token (defaults to theme border).
  // backgroundColor: sticky defaults to amber; rect/ellipse stay transparent
  // (border-only) unless the author sets a background token explicitly. text
  // has no background token at all.
  const effectiveBg = isText
    ? undefined
    : (data.backgroundColor ?? (shape === 'sticky' ? 'amber' : undefined));
  // US-016: selection draws a thin (1px), low-contrast outer rectangle 4px
  // outside the node — the standard design-tool selection box. Outline is
  // used (not a wider border or absolute overlay) so layout never shifts and
  // every shape (chromed + chromeless text) gets the same affordance. The
  // four corner resize handles below render at the node's own corners; with
  // an 8x10px visible square + 4px outline-offset, the handles visually sit
  // at the rect's corners.
  const resolvedBorderColor = colorTokenStyle(data.borderColor, 'node').borderColor;
  const colorStyle: CSSProperties = {
    ...(isText
      ? {}
      : {
          borderColor: resolvedBorderColor,
          backgroundColor: effectiveBg
            ? colorTokenStyle(effectiveBg, 'node').backgroundColor
            : undefined,
          borderWidth: data.borderSize !== undefined ? data.borderSize : undefined,
          borderStyle: data.borderStyle,
        }),
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
    ...(selected
      ? {
          outlineWidth: '1px',
          outlineStyle: 'solid',
          outlineColor: 'hsl(var(--primary) / 0.4)',
          outlineOffset: '4px',
        }
      : {}),
  };
  const labelFontStyle: CSSProperties =
    data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {};
  const style: CSSProperties = sized
    ? colorStyle
    : { ...colorStyle, width: data.width ?? size.width, height: data.height ?? size.height };

  // US-012: dblclick anywhere on the node body enters label-edit mode. The
  // wrapper handler bails out for handles + resize controls so connect/resize
  // gestures keep their drag semantics, and is a no-op when already editing or
  // when the node doesn't expose a label-change callback.
  const handleWrapperDoubleClick = labelEditable
    ? (e: ReactMouseEvent<HTMLDivElement>) => {
        if (isEditing) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest('.react-flow__handle')) return;
        if (target?.closest('.react-flow__resize-control')) return;
        e.stopPropagation();
        setIsEditing(true);
      }
    : undefined;

  return (
    <div
      className={cn(
        'group relative flex items-center justify-center p-2 text-center text-[22px]',
        sized ? 'h-full w-full' : '',
        SHAPE_CLASS[shape],
      )}
      style={style}
      data-testid="shape-node"
      data-shape={shape}
      onDoubleClick={handleWrapperDoubleClick}
    >
      <ResizeControls
        visible={!!selected && !!data.onResize && !isEditing}
        cornerVariant="visible"
        minWidth={80}
        minHeight={40}
        onResizeStart={() => {
          setIsResizing(true);
          data.setResizing?.(true);
        }}
        onResizeEnd={(_e, params) => {
          setIsResizing(false);
          data.setResizing?.(false);
          data.onResize?.(id, { width: params.width, height: params.height });
        }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="t"
        className={cn(HANDLE_CLASS, selected && '!opacity-100')}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        className={cn(HANDLE_CLASS, selected && '!opacity-100')}
      />
      {isEditing && labelEditable ? (
        <InlineEdit
          initialValue={data.label ?? ''}
          field="node-label"
          commitMode="blur-only"
          onCommit={(v) => data.onLabelChange?.(id, v)}
          onExit={() => setIsEditing(false)}
          className="text-[22px]"
          style={labelFontStyle}
          placeholder={isText ? 'Text' : 'Label'}
        />
      ) : (
        <button
          type="button"
          className={cn(
            'block whitespace-pre-wrap bg-transparent p-0 font-medium leading-tight',
            data.label ? 'break-words' : 'text-muted-foreground/40 italic',
          )}
          style={labelFontStyle}
        >
          {data.label ?? (labelEditable ? (isText ? 'Text' : 'Double-click to label') : '')}
        </button>
      )}
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        className={cn(HANDLE_CLASS, selected && '!opacity-100')}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        className={cn(HANDLE_CLASS, selected && '!opacity-100')}
      />
    </div>
  );
}
