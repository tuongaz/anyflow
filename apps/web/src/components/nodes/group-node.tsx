import { ResizeControls } from '@/components/nodes/resize-controls';
import { useResizeGesture } from '@/components/nodes/use-resize-gesture';
import type { GroupNodeData } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Node, NodeProps } from '@xyflow/react';
import { memo } from 'react';

export type GroupNodeRuntimeData = GroupNodeData & {
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
} & Record<string, unknown>;
export type GroupNodeType = Node<GroupNodeRuntimeData, 'group'>;

// US-011: minimum dimensions for a group. Wide enough to host the label slot
// at a comfortable size and deep enough to contain a typical labeled child.
const MIN_W = 120;
const MIN_H = 80;
export const GROUP_DEFAULT_SIZE = { width: 320, height: 220 } as const;

// US-011: label slot height. Reserved at the top of the group's bounding box
// so children whose `parentId` points at the group don't visually collide with
// the label text. ~28px matches the AC's "empty ~28px tall strip" requirement.
const LABEL_SLOT_HEIGHT = 28;

function GroupNodeImpl({ id, data, selected }: NodeProps<GroupNodeType>) {
  const { isResizing, onResizeStart, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing,
  });
  // Once user-resized (or pre-sized via authoring), the React Flow wrapper
  // owns dimensions and the inner fills via h-full w-full. Before any resize,
  // we pin a default size so the wrapper auto-sizes to it.
  const sized = isResizing || data.width !== undefined || data.height !== undefined;

  // Chrome (dashed border, transparent fill, selected outline) lives in CSS
  // (.react-flow__node-group rules in apps/web/src/index.css) so this
  // component's render stays minimal and theme/style changes don't touch JSX.
  return (
    <div
      className={cn('relative', sized ? 'h-full w-full' : '')}
      data-testid="group-node"
      data-label={data.label && data.label.length > 0 ? data.label : undefined}
      style={
        sized ? undefined : { width: GROUP_DEFAULT_SIZE.width, height: GROUP_DEFAULT_SIZE.height }
      }
    >
      <ResizeControls
        visible={!!selected && !!data.onResize}
        cornerVariant="visible"
        minWidth={MIN_W}
        minHeight={MIN_H}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />
      <div
        className="react-flow__node-group-label"
        data-testid="group-node-label"
        style={{ height: LABEL_SLOT_HEIGHT }}
      >
        {data.label && data.label.length > 0 ? data.label : null}
      </div>
    </div>
  );
}

// US-010 / US-011: see play-node.tsx — skip re-renders on xyflow's internal
// prop ticks (dragging, isConnectable, xPos/yPos) so a marquee gesture or a
// child drag doesn't churn the group's render.
function arePropsEqual(prev: NodeProps<GroupNodeType>, next: NodeProps<GroupNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const GroupNode = memo(GroupNodeImpl, arePropsEqual);
