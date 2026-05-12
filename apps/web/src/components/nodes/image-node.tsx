import { LockBadge } from '@/components/nodes/lock-badge';
import { ResizeControls } from '@/components/nodes/resize-controls';
import { useResizeGesture } from '@/components/nodes/use-resize-gesture';
import type { ImageNodeData } from '@/lib/api';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '@/lib/color-tokens';
import { cn } from '@/lib/utils';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { type CSSProperties, memo } from 'react';

export type ImageNodeRuntimeData = ImageNodeData & {
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
} & Record<string, unknown>;
export type ImageNodeType = Node<ImageNodeRuntimeData, 'imageNode'>;

export const IMAGE_DEFAULT_SIZE = { width: 200, height: 150 } as const;

const MIN_W = 40;
const MIN_H = 40;

const HANDLE_CLASS = 'opacity-0 transition-opacity';

function ImageNodeImpl({ id, data, selected, isConnectable }: NodeProps<ImageNodeType>) {
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing,
  });
  // Once user-resized (or pre-sized via authoring), the React Flow wrapper
  // owns dimensions and the inner fills via h-full w-full. Before any resize,
  // we pin a default 200x150 so the wrapper auto-sizes to it.
  const sized = isResizing || data.width !== undefined || data.height !== undefined;

  // US-010: selection outline moved to CSS (see play-node.tsx note).
  // US-014: render the optional image border from `borderColor` / `borderWidth`
  // / `borderStyle`. Each field is independently optional; only the keys whose
  // data value is defined land in the style object so the "chromeless image"
  // default is preserved when nothing is set.
  // US-021: image nodes default to a white fill when `backgroundColor` is
  // unset — so transparent PNGs / partial-alpha screenshots read as a clean
  // framed image on light AND dark canvases. Field stays unset on disk; this
  // is a render-time fallback only. An explicit token wins.
  const containerStyle: CSSProperties = {
    backgroundColor:
      data.backgroundColor !== undefined
        ? colorTokenStyle(data.backgroundColor, 'node').backgroundColor
        : NODE_DEFAULT_BG_WHITE,
    ...(data.borderColor !== undefined
      ? { borderColor: colorTokenStyle(data.borderColor, 'node').borderColor }
      : {}),
    ...(data.borderWidth !== undefined ? { borderWidth: data.borderWidth } : {}),
    ...(data.borderStyle !== undefined ? { borderStyle: data.borderStyle } : {}),
    ...(data.cornerRadius !== undefined ? { borderRadius: data.cornerRadius } : {}),
    ...(sized ? {} : { width: IMAGE_DEFAULT_SIZE.width, height: IMAGE_DEFAULT_SIZE.height }),
  };

  return (
    <div
      className={cn('group relative overflow-hidden', sized ? 'h-full w-full' : '')}
      style={containerStyle}
      data-testid="image-node"
    >
      <ResizeControls
        visible={!!selected && !!data.onResize && !data.locked}
        cornerVariant="visible"
        minWidth={MIN_W}
        minHeight={MIN_H}
        onResizeStart={onResizeStart}
        onResize={onResizeEvent}
        onResizeEnd={onResizeEnd}
      />
      {data.locked ? <LockBadge /> : null}
      <Handle
        type="target"
        position={Position.Top}
        id="t"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && '!opacity-100')}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && '!opacity-100')}
      />
      <img
        src={data.image}
        alt={data.alt ?? ''}
        // `block` strips the inline-element baseline gap that would otherwise
        // leave a thin strip below the image inside the node container.
        // `pointer-events-none` ensures the React Flow wrapper still receives
        // drag/select gestures rather than the browser's native image drag.
        className="block h-full w-full select-none object-contain pointer-events-none"
        draggable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && '!opacity-100')}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && '!opacity-100')}
      />
    </div>
  );
}

// US-010: see play-node.tsx — skip re-renders on xyflow's internal prop ticks.
function arePropsEqual(prev: NodeProps<ImageNodeType>, next: NodeProps<ImageNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const ImageNode = memo(ImageNodeImpl, arePropsEqual);
