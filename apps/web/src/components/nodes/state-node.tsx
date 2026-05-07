import { type NodeStatus, StatusPill } from '@/components/nodes/status-pill';
import type { NodeData } from '@/lib/api';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';

export type StateNodeData = NodeData & { status: NodeStatus } & Record<string, unknown>;
export type StateNodeType = Node<StateNodeData, 'stateNode'>;

export function StateNode({ data, selected }: NodeProps<StateNodeType>) {
  const status = data.status ?? 'idle';
  const description = data.detail?.summary ?? data.kind;

  return (
    <div
      className={`group flex min-w-[220px] flex-col rounded-lg border-2 border-dashed bg-card shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-ring ring-offset-2' : ''
      } ${status === 'running' ? 'anydemo-node-pulse' : ''}`}
      data-status={status}
      data-testid="state-node"
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground" />
      <div
        className="flex items-center justify-between gap-2 rounded-t-md border-b bg-muted/40 px-3 py-1.5"
        data-testid="node-header"
      >
        <div className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
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
      <div className="px-3 py-2 text-[12px] text-muted-foreground line-clamp-2">{description}</div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />
    </div>
  );
}
