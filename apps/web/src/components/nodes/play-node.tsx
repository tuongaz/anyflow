import { type NodeStatus, StatusPill } from '@/components/nodes/status-pill';
import { Button } from '@/components/ui/button';
import type { NodeData } from '@/lib/api';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { Play } from 'lucide-react';

export type PlayNodeData = NodeData & {
  status: NodeStatus;
  onPlay?: (nodeId: string) => void;
} & Record<string, unknown>;
export type PlayNodeType = Node<PlayNodeData, 'playNode'>;

export function PlayNode({ id, data, selected }: NodeProps<PlayNodeType>) {
  const status = data.status ?? 'idle';
  const action = data.playAction;
  const subtitle = action ? `${action.method} ${action.url}` : data.kind;
  const playable = !!action && !!data.onPlay;
  const isRunning = status === 'running';

  return (
    <div
      className={`group flex min-w-[220px] flex-col gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-ring ring-offset-2' : ''
      } ${isRunning ? 'anydemo-node-pulse' : ''}`}
      data-status={status}
      data-testid="play-node"
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground" />
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-tight truncate">{data.label}</div>
          <div className="text-[11px] text-muted-foreground truncate font-mono">{subtitle}</div>
        </div>
        <StatusPill status={status} />
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!playable || isRunning}
        className="h-7 gap-1 px-2 text-xs"
        data-testid="play-button"
        onClick={(e) => {
          e.stopPropagation();
          data.onPlay?.(id);
        }}
      >
        <Play className="h-3 w-3" />
        {isRunning ? 'Running…' : 'Play'}
      </Button>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />
    </div>
  );
}
