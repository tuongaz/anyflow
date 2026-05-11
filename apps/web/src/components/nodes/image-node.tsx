import { ResizeControls } from '@/components/nodes/resize-controls';
import { useResizeGesture } from '@/components/nodes/use-resize-gesture';
import type { ImageNodeData } from '@/lib/api';
import { colorTokenStyle } from '@/lib/color-tokens';
import { cn } from '@/lib/utils';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type { CSSProperties } from 'react';

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

export function ImageNode({ id, data, selected, isConnectable }: NodeProps<ImageNodeType>) {
  const { isResizing, onResizeStart, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing,
  });
  // Once user-resized (or pre-sized via authoring), the React Flow wrapper
  // owns dimensions and the inner fills via h-full w-full. Before any resize,
  // we pin a default 200x150 so the wrapper auto-sizes to it.
  const sized = isResizing || data.width !== undefined || data.height !== undefined;

  const containerStyle: CSSProperties = {
    borderColor: colorTokenStyle(data.borderColor, 'node').borderColor,
    borderWidth: data.borderSize !== undefined ? data.borderSize : undefined,
    borderStyle: data.borderStyle,
    borderRadius: data.cornerRadius !== undefined ? data.cornerRadius : undefined,
    ...(sized ? {} : { width: IMAGE_DEFAULT_SIZE.width, height: IMAGE_DEFAULT_SIZE.height }),
    ...(selected
      ? {
          outlineWidth: '1px',
          outlineStyle: 'solid',
          outlineColor: 'hsl(var(--primary) / 0.4)',
          outlineOffset: '4px',
        }
      : {}),
  };

  return (
    <div
      className={cn('group relative overflow-hidden', sized ? 'h-full w-full' : '')}
      style={containerStyle}
      data-testid="image-node"
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
