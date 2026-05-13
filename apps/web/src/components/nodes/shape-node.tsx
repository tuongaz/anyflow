import { InlineEdit } from '@/components/inline-edit';
import { LockBadge } from '@/components/nodes/lock-badge';
import { ResizeControls } from '@/components/nodes/resize-controls';
import { DatabaseShape } from '@/components/nodes/shapes/database';
import { useResizeGesture } from '@/components/nodes/use-resize-gesture';
import type { ShapeKind, ShapeNodeData } from '@/lib/api';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '@/lib/color-tokens';
import { cn } from '@/lib/utils';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  memo,
  useState,
} from 'react';

// US-009: illustrative shapes own their visuals via inline-SVG components
// under `apps/web/src/components/nodes/shapes/`. The wrapper's Tailwind chrome
// (border / bg / rotation) is suppressed for these shapes — see `SHAPE_CLASS`
// + `shapeChromeStyle` below — so the SVG can draw the whole visual without
// fighting CSS borders. Extend this set when adding a new illustrative shape.
const ILLUSTRATIVE_SHAPES: ReadonlySet<ShapeKind> = new Set<ShapeKind>(['database']);

function isIllustrativeShape(shape: ShapeKind): boolean {
  return ILLUSTRATIVE_SHAPES.has(shape);
}

export type ShapeNodeRuntimeData = ShapeNodeData & {
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  /** Persist a new name (PATCH /nodes/:id { name }). Optional for shape nodes. */
  onNameChange?: (nodeId: string, name: string) => void;
  /**
   * US-015: when true on the first mount, the node enters inline label-edit
   * mode automatically. Used by the drop-on-pane popover so the user can type
   * a label immediately after creating a node via drag-from-handle. The flag
   * is consumed once at mount and never re-read; flipping it later has no
   * effect (the local `isEditing` state is owned by the InlineEdit lifecycle).
   */
  autoEditOnMount?: boolean;
} & Record<string, unknown>;
export type ShapeNodeType = Node<ShapeNodeRuntimeData, 'shapeNode'>;

export const SHAPE_DEFAULT_SIZE: Record<ShapeKind, { width: number; height: number }> = {
  rectangle: { width: 200, height: 120 },
  ellipse: { width: 200, height: 120 },
  sticky: { width: 180, height: 180 },
  text: { width: 160, height: 40 },
  // US-009: cylinder reads best in portrait — the rim disc looks proportional
  // when the body is taller than wide.
  database: { width: 120, height: 140 },
};

// `text` deliberately omits border + background so the shape reads as a free
// floating annotation (no chrome). Selection still draws an outline (handled
// below by the `selected` branch on `colorStyle`).
//
// Exported (along with `shapeChromeClass` / `shapeChromeStyle` below) so the
// drag-create ghost in demo-canvas.tsx (US-009) can mirror the committed
// node's chrome byte-for-byte without duplicating literals. Any visual change
// to a shape's chrome MUST land here so both the node and the ghost update
// together.
export const SHAPE_CLASS: Record<ShapeKind, string> = {
  rectangle: 'rounded-lg border-[3px] bg-transparent',
  ellipse: 'rounded-full border-[3px] bg-transparent',
  sticky: 'rounded-md border-[3px] shadow-md -rotate-1',
  text: 'bg-transparent',
  // US-009: illustrative shapes have no wrapper chrome — the inline SVG owns
  // border + fill so the wrapper stays a transparent positioning host.
  database: '',
};

/**
 * Tailwind class string for a shape's chrome (border-radius, default border
 * width, sticky tilt + shadow). The pair of `shapeChromeClass` +
 * `shapeChromeStyle` is the single source of truth consumed by both
 * `ShapeNode` (live render) and `demo-canvas.tsx`'s drag-create ghost
 * (`canvas-draw-ghost`, US-009) so the preview shown during drag matches the
 * committed node exactly.
 */
export function shapeChromeClass(shape: ShapeKind): string {
  return SHAPE_CLASS[shape];
}

/**
 * Inline style for a shape's chrome (borderColor / backgroundColor /
 * borderWidth / borderStyle / borderRadius). Mirrors the resolution rules in
 * `ShapeNode` so the ghost preview (US-009) and the committed node share the
 * same values; pass an empty `data` to get the default-color look the
 * drag-create flow commits via `onCreateShapeNode` (which sends only
 * `{ shape, width, height }` — no color overrides).
 */
export function shapeChromeStyle(
  shape: ShapeKind,
  data?: Pick<
    ShapeNodeData,
    'backgroundColor' | 'borderColor' | 'borderSize' | 'borderStyle' | 'cornerRadius'
  >,
): CSSProperties {
  if (shape === 'text') return {};
  // US-009: illustrative shapes draw their own border + fill inside the SVG
  // (see `apps/web/src/components/nodes/shapes/`), so the wrapper must stay
  // chrome-free — otherwise CSS borders would overlap the SVG strokes and
  // backgrounds would clip the rim.
  if (isIllustrativeShape(shape)) return {};
  // US-021: rectangle + ellipse fall back to a literal white fill when the
  // author hasn't set `backgroundColor`, so the canvas reads as a clean diagram
  // on light AND dark themes (whiteboard-app convention). The field stays
  // unset on disk — this is a render-time fallback only. Sticky keeps its
  // pre-existing amber default; text is excluded (chromeless per US-003).
  const explicitToken = data?.backgroundColor;
  let backgroundColor: string | undefined;
  if (explicitToken !== undefined) {
    backgroundColor = colorTokenStyle(explicitToken, 'node').backgroundColor;
  } else if (shape === 'sticky') {
    backgroundColor = colorTokenStyle('amber', 'node').backgroundColor;
  } else if (shape === 'rectangle' || shape === 'ellipse') {
    backgroundColor = NODE_DEFAULT_BG_WHITE;
  }
  const supportsCornerRadius = shape === 'rectangle' || shape === 'sticky';
  return {
    borderColor: colorTokenStyle(data?.borderColor, 'node').borderColor,
    backgroundColor,
    borderWidth: data?.borderSize !== undefined ? data.borderSize : undefined,
    borderStyle: data?.borderStyle,
    borderRadius:
      supportsCornerRadius && data?.cornerRadius !== undefined ? data.cornerRadius : undefined,
  };
}

// US-009: resolve a shapeNode's ColorToken `borderColor` / `backgroundColor`
// into concrete CSS values for the per-shape SVG. Unset `backgroundColor`
// falls through to NODE_DEFAULT_BG_WHITE so cylinders read crisp on dark
// themes, mirroring the US-021 white-default already applied to rectangle /
// ellipse. Inline in `ShapeNodeImpl` (vs a nested component) so the test
// suite's hook-shim renderer sees the per-shape SVG element directly in the
// returned tree.
function resolveIllustrativeColors(data: ShapeNodeData): {
  borderColor: string | undefined;
  backgroundColor: string | undefined;
} {
  return {
    borderColor: colorTokenStyle(data.borderColor, 'node').borderColor,
    backgroundColor:
      data.backgroundColor !== undefined
        ? colorTokenStyle(data.backgroundColor, 'node').backgroundColor
        : NODE_DEFAULT_BG_WHITE,
  };
}

// Handles stay hidden by default and only render on the active (selected) node
// — the `selected && '!opacity-100'` branch in each <Handle>'s className. While
// a connection is in progress, `.react-flow.anydemo-connecting .react-flow__handle`
// (apps/web/src/index.css) globally forces `opacity: 1` so drop targets light
// up across all nodes during the drag, preserving the US-014 auto-snap UX.
const HANDLE_CLASS = 'opacity-0 transition-opacity';

function ShapeNodeImpl({ id, data, selected, isConnectable }: NodeProps<ShapeNodeType>) {
  const shape = data.shape;
  const size = SHAPE_DEFAULT_SIZE[shape];
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing,
  });
  // US-015: a freshly drop-popover-created node opens directly in label-edit
  // mode so the user can type a label without an extra dblclick. The flag is
  // read ONCE at mount via the lazy initializer; subsequent renders keep the
  // local state regardless of whether the upstream injection clears the flag
  // (e.g. because the parent's pendingEditNodeId moved to a different node).
  const [isEditing, setIsEditing] = useState(() => Boolean(data.autoEditOnMount));
  const nameEditable = !!data.onNameChange;
  // While resizing OR once data.width/height are set, the React Flow wrapper
  // owns the dimensions; the inner fills via h-full w-full. Before any resize,
  // we still need an explicit size so the wrapper auto-sizes to it.
  const sized = isResizing || data.width !== undefined || data.height !== undefined;

  // Text shapes are chromeless: no border, no background. Selection still
  // needs a visible affordance — handled below by the unified outer-rect
  // outline so text and chromed shapes share the exact same selection chrome.
  const isText = shape === 'text';
  // For text shapes, `borderColor` is repurposed as the text color (the field
  // is hidden as a border in the renderer, so reusing it avoids a redundant
  // schema field). `colorTokenStyle(_, 'text')` returns {} for the default
  // token so unset values fall through to the theme foreground.
  const textColorStyle = isText ? colorTokenStyle(data.borderColor, 'text') : {};
  // US-010: selection outline moved to CSS (`.react-flow__node.selected > div`
  // in index.css) so the inline style is stable across renders — necessary
  // for `React.memo`'s prop-equality on this renderer. Text shapes (no
  // border or background of their own) still get the outline via the same
  // CSS rule, matching the pre-US-010 behaviour where the selection box was
  // the only affordance on text.
  // US-004: cornerRadius only applies to shapes that have a square-ish border
  // we can round — rectangle and sticky. Ellipse keeps its rounded-full (50%)
  // and text has no border to round, so we leave them alone.
  const colorStyle: CSSProperties = {
    ...shapeChromeStyle(shape, data),
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
  };
  const labelFontStyle: CSSProperties = {
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
    ...textColorStyle,
  };
  const style: CSSProperties = sized
    ? colorStyle
    : { ...colorStyle, width: data.width ?? size.width, height: data.height ?? size.height };

  // US-012: dblclick anywhere on the node body enters label-edit mode. The
  // wrapper handler bails out for handles + resize controls so connect/resize
  // gestures keep their drag semantics, and is a no-op when already editing or
  // when the node doesn't expose a label-change callback.
  const handleWrapperDoubleClick = nameEditable
    ? (e: ReactMouseEvent<HTMLDivElement>) => {
        if (isEditing) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest('.react-flow__handle')) return;
        if (target?.closest('.react-flow__resize-control')) return;
        e.stopPropagation();
        setIsEditing(true);
      }
    : undefined;

  // US-009: illustrative shape overlay. Renders BEFORE the label JSX so the
  // label (positioned via the `relative` class below) stacks above by DOM
  // order — no z-index gymnastics needed. The overlay is `pointer-events-none`
  // so the label, handles, and resize controls keep their hit targets. The
  // dispatch is inline (not behind a wrapper component) so the per-shape SVG
  // sits directly in the returned tree — keeps `ShapeNodeImpl`'s shallow
  // render visible to the hook-shim test renderer in `shape-node.test.tsx`.
  let illustrativeOverlay: ReactNode = null;
  if (isIllustrativeShape(shape)) {
    const w = data.width ?? size.width;
    const h = data.height ?? size.height;
    const { borderColor, backgroundColor } = resolveIllustrativeColors(data);
    illustrativeOverlay = (
      <div className="pointer-events-none absolute inset-0">
        {shape === 'database' ? (
          <DatabaseShape
            width={w}
            height={h}
            borderColor={borderColor}
            backgroundColor={backgroundColor}
            borderSize={data.borderSize}
            borderStyle={data.borderStyle}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group relative flex items-center justify-center p-2 text-center text-[22px]',
        sized ? 'h-full w-full' : '',
        shapeChromeClass(shape),
      )}
      style={style}
      data-testid="shape-node"
      data-shape={shape}
      onDoubleClick={handleWrapperDoubleClick}
    >
      {illustrativeOverlay}
      <ResizeControls
        visible={!!selected && !!data.onResize && !isEditing && !data.locked}
        cornerVariant="visible"
        minWidth={80}
        minHeight={40}
        onResizeStart={onResizeStart}
        onResize={onResizeEvent}
        onResizeEnd={onResizeEnd}
      />
      {data.locked ? <LockBadge /> : null}
      {/* US-003: text shapes are pure annotations — no connect handles. */}
      {!isText && (
        <Handle
          type="target"
          position={Position.Top}
          id="t"
          isConnectable={isConnectable}
          className={cn(HANDLE_CLASS, selected && '!opacity-100')}
        />
      )}
      {!isText && (
        <Handle
          type="target"
          position={Position.Left}
          id="l"
          isConnectable={isConnectable}
          className={cn(HANDLE_CLASS, selected && '!opacity-100')}
        />
      )}
      {isEditing && nameEditable ? (
        <InlineEdit
          initialValue={data.name ?? ''}
          field="node-label"
          commitMode="blur-only"
          onCommit={(v) => data.onNameChange?.(id, v)}
          onExit={() => setIsEditing(false)}
          // US-009: `relative` keeps the label as a positioned sibling of the
          // illustrative overlay above, so DOM order alone is enough to stack
          // it over the SVG without juggling explicit z-index values.
          className="relative text-[22px]"
          style={labelFontStyle}
          placeholder={isText ? 'Text' : 'Label'}
        />
      ) : (
        <button
          type="button"
          className={cn(
            // US-009: `relative` — see the InlineEdit branch above.
            'relative block whitespace-pre-wrap bg-transparent p-0 font-medium leading-tight',
            data.name ? 'break-words' : 'text-muted-foreground/40 italic',
          )}
          style={labelFontStyle}
        >
          {data.name ?? (nameEditable ? (isText ? 'Text' : 'Double-click to label') : '')}
        </button>
      )}
      {!isText && (
        <Handle
          type="source"
          position={Position.Right}
          id="r"
          isConnectable={isConnectable}
          className={cn(HANDLE_CLASS, selected && '!opacity-100')}
        />
      )}
      {!isText && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="b"
          isConnectable={isConnectable}
          className={cn(HANDLE_CLASS, selected && '!opacity-100')}
        />
      )}
    </div>
  );
}

// US-010: see play-node.tsx — skip re-renders on xyflow's internal prop ticks.
function arePropsEqual(prev: NodeProps<ShapeNodeType>, next: NodeProps<ShapeNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const ShapeNode = memo(ShapeNodeImpl, arePropsEqual);
