import { ResizeControls } from '@/components/nodes/resize-controls';
import { useResizeGesture } from '@/components/nodes/use-resize-gesture';
import type { IconNodeData } from '@/lib/api';
import { colorTokenStyle } from '@/lib/color-tokens';
import { ICON_REGISTRY } from '@/lib/icon-registry';
import { cn } from '@/lib/utils';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';

export type IconNodeRuntimeData = IconNodeData & {
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  // US-016: double-click an iconNode → open the picker in replace mode.
  // Wired by demo-canvas's buildNode for iconNode-typed nodes and dispatched
  // by demo-view's openIconPicker('replace', id). Absent → dblclick is a no-op
  // (the no-demo / readonly contexts where the picker isn't wired).
  onRequestIconReplace?: (nodeId: string) => void;
} & Record<string, unknown>;
export type IconNodeType = Node<IconNodeRuntimeData, 'iconNode'>;

export const ICON_DEFAULT_SIZE = { width: 48, height: 48 } as const;
export const ICON_FALLBACK_NAME = 'help-circle';

const MIN_W = 24;
const MIN_H = 24;

const HANDLE_CLASS = 'opacity-0 transition-opacity';

// PRD spec says `colorTokenStyle(data.color, 'node').color ?? 'currentColor'`,
// but `colorTokenStyle(_, 'node')` returns { borderColor, backgroundColor } —
// it has no `.color` property, so the icon would always fall through to
// `currentColor` and `data.color` would have no effect (contradicting the
// "data.color overrides default" acceptance). Use 'text' to get the saturated
// edge color that matches the rest of the palette for chromeless glyphs;
// 'default' token returns `{}` so unset values fall through to `currentColor`.
function resolveIconColor(token: IconNodeData['color']): string {
  return colorTokenStyle(token, 'text').color ?? 'currentColor';
}

// Console-warn once per unknown icon name so a broken demo doesn't spam logs.
const WARNED_NAMES = new Set<string>();

export function IconNode({ id, data, selected }: NodeProps<IconNodeType>) {
  const { isResizing, onResizeStart, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing,
  });
  const sized = isResizing || data.width !== undefined || data.height !== undefined;

  const requested = ICON_REGISTRY[data.icon];
  if (!requested && !WARNED_NAMES.has(data.icon)) {
    WARNED_NAMES.add(data.icon);
    console.warn(
      `[iconNode] Unknown icon "${data.icon}"; falling back to "${ICON_FALLBACK_NAME}".`,
    );
  }
  const IconComponent = requested ?? ICON_REGISTRY[ICON_FALLBACK_NAME];

  const iconColor = resolveIconColor(data.color);
  const strokeWidth = data.strokeWidth ?? 2;

  const containerStyle: CSSProperties = {
    ...(sized ? {} : { width: ICON_DEFAULT_SIZE.width, height: ICON_DEFAULT_SIZE.height }),
    ...(selected
      ? {
          outlineWidth: '1px',
          outlineStyle: 'solid',
          outlineColor: 'hsl(var(--primary) / 0.4)',
          outlineOffset: '4px',
        }
      : {}),
  };

  // US-016: dblclick opens the picker in replace mode for this node. Mirrors
  // shape-node's dblclick-to-edit-label convention — primary content gets
  // edited. stopPropagation prevents React Flow's canvas dblclick handler from
  // also firing (which creates a new shape in some regions).
  const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!data.onRequestIconReplace) return;
    e.stopPropagation();
    data.onRequestIconReplace(id);
  };

  return (
    <div
      className={cn('group relative', sized ? 'h-full w-full' : '')}
      style={containerStyle}
      data-testid="icon-node"
      onDoubleClick={handleDoubleClick}
    >
      <ResizeControls
        visible={!!selected && !!data.onResize}
        cornerVariant="visible"
        minWidth={MIN_W}
        minHeight={MIN_H}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
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
      {IconComponent ? (
        <IconComponent
          color={iconColor}
          strokeWidth={strokeWidth}
          absoluteStrokeWidth
          aria-label={data.alt}
          className="block h-full w-full pointer-events-none select-none"
        />
      ) : null}
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
