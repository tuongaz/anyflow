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
  const description = data.detail?.summary ?? data.kind;
  const playable = !!action && !!data.onPlay;
  const isRunning = status === 'running';

  return (
    <div
      className={`group flex w-[260px] flex-col rounded-lg border bg-card shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-ring ring-offset-2' : ''
      } ${isRunning ? 'anydemo-node-pulse' : ''}`}
      data-status={status}
      data-testid="play-node"
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground" />
      <div
        className="flex items-start justify-between gap-2 rounded-t-lg border-b bg-muted/40 px-3 py-1.5"
        data-testid="node-header"
      >
        <div className="min-w-0 flex-1 break-words text-sm font-medium leading-tight">
          {data.label}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StatusPill status={status} />
          <div className="flex shrink-0 items-center justify-end gap-1" data-testid="node-actions">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!playable || isRunning}
              className="h-6 gap-1 px-2 text-xs"
              data-testid="play-button"
              onClick={(e) => {
                e.stopPropagation();
                data.onPlay?.(id);
              }}
            >
              <Play className="h-3 w-3" />
              {isRunning ? 'Running…' : 'Play'}
            </Button>
          </div>
        </div>
      </div>
      <div className="px-3 py-2 text-[12px] text-muted-foreground break-words">{description}</div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />
    </div>
  );
}
