import { type NodeStatus, StatusPill } from '@/components/nodes/status-pill';
import type { NodeData } from '@/lib/api';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';

export type StateNodeData = NodeData & { status: NodeStatus } & Record<string, unknown>;
export type StateNodeType = Node<StateNodeData, 'stateNode'>;

export function StateNode({ data, selected }: NodeProps<StateNodeType>) {
  const status = data.status ?? 'idle';
  const sourceLabel = data.stateSource.kind === 'event' ? 'event-bound' : 'request-bound';

  return (
    <div
      className={`group flex min-w-[200px] flex-col gap-1 rounded-lg border-2 border-dashed bg-card px-3 py-2 shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-ring ring-offset-2' : ''
      } ${status === 'running' ? 'anydemo-node-pulse' : ''}`}
      data-status={status}
      data-testid="state-node"
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground" />
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-tight truncate">{data.label}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {data.kind} · {sourceLabel}
          </div>
        </div>
        <StatusPill status={status} />
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />
    </div>
  );
}
