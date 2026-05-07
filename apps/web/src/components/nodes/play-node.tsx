import { type NodeStatus, StatusPill } from '@/components/nodes/status-pill';
import { Button } from '@/components/ui/button';
import type { NodeData } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Handle, type Node, type NodeProps, NodeResizer, Position } from '@xyflow/react';
import { Play } from 'lucide-react';
import { useState } from 'react';

export type PlayNodeData = NodeData & {
  status: NodeStatus;
  onPlay?: (nodeId: string) => void;
  onResize?: (nodeId: string, dims: { width: number; height: number }) => void;
  setResizing?: (on: boolean) => void;
} & Record<string, unknown>;
export type PlayNodeType = Node<PlayNodeData, 'playNode'>;

export function PlayNode({ id, data, selected }: NodeProps<PlayNodeType>) {
  const status = data.status ?? 'idle';
  const action = data.playAction;
  const description = data.detail?.summary ?? data.kind;
  const playable = !!action && !!data.onPlay;
  const isRunning = status === 'running';
  // Track an in-flight resize gesture locally so the inner card follows the
  // React Flow wrapper's width/height the moment NodeResizer dispatches a
  // dimension change. After resize-stop, data.width/height are set via the
  // pending override (US-021) and we keep filling the wrapper.
  const [isResizing, setIsResizing] = useState(false);
  const sized = isResizing || data.width !== undefined || data.height !== undefined;

  return (
    <div
      className={cn(
        'group flex flex-col rounded-lg border bg-card shadow-sm transition-shadow',
        sized ? 'h-full w-full' : 'w-[260px]',
        selected ? 'ring-2 ring-ring ring-offset-2' : '',
        isRunning ? 'anydemo-node-pulse' : '',
      )}
      data-status={status}
      data-testid="play-node"
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
      <div className="flex-1 px-3 py-2 text-[12px] text-muted-foreground break-words">
        {description}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />
    </div>
  );
}
