import { type NodeStatus, StatusPill } from '@/components/nodes/status-pill';
import type { NodeData } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Handle, type Node, type NodeProps, NodeResizer, Position } from '@xyflow/react';
import { useState } from 'react';

export type StateNodeData = NodeData & {
  status: NodeStatus;
  onResize?: (nodeId: string, dims: { width: number; height: number }) => void;
  setResizing?: (on: boolean) => void;
} & Record<string, unknown>;
export type StateNodeType = Node<StateNodeData, 'stateNode'>;

export function StateNode({ id, data, selected }: NodeProps<StateNodeType>) {
  const status = data.status ?? 'idle';
  const description = data.detail?.summary ?? data.kind;
  const [isResizing, setIsResizing] = useState(false);
  const sized = isResizing || data.width !== undefined || data.height !== undefined;

  return (
    <div
      className={cn(
        'group flex flex-col rounded-lg border-2 border-dashed bg-card shadow-sm transition-shadow',
        sized ? 'h-full w-full' : 'w-[260px]',
        selected ? 'ring-2 ring-ring ring-offset-2' : '',
        status === 'running' ? 'anydemo-node-pulse' : '',
      )}
      data-status={status}
      data-testid="state-node"
    >
      <NodeResizer
        isVisible={selected && !!data.onResize}
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
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground" />
      <div
        className="flex items-start justify-between gap-2 rounded-t-md border-b bg-muted/40 px-3 py-1.5"
        data-testid="node-header"
      >
        <div className="min-w-0 flex-1 break-words text-sm font-medium leading-tight">
          {data.label}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StatusPill status={status} />
          <div
            className="flex shrink-0 items-center justify-end gap-1"
            data-testid="node-actions"
          />
        </div>
      </div>
      <div className="flex-1 px-3 py-2 text-[12px] text-muted-foreground break-words">
        {description}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />
    </div>
  );
}
