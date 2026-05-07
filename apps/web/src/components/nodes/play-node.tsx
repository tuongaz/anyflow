import { InlineEdit } from '@/components/inline-edit';
import { type NodeStatus, StatusPill } from '@/components/nodes/status-pill';
import { Button } from '@/components/ui/button';
import type { NodeData } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Handle, type Node, type NodeProps, NodeResizer, Position } from '@xyflow/react';
import { Loader2, Play } from 'lucide-react';
import { useState } from 'react';

export type PlayNodeData = NodeData & {
  /**
   * Undefined when this node has no entry in the runs map (i.e. the user has
   * never clicked Play on it). The PlayNode hides its StatusPill in that case
   * (per US-030); once a run is dispatched, status becomes 'running' →
   * 'done'/'error' and the pill becomes visible thereafter.
   */
  status?: NodeStatus;
  onPlay?: (nodeId: string) => void;
  onResize?: (nodeId: string, dims: { width: number; height: number }) => void;
  setResizing?: (on: boolean) => void;
  /** Persist a new label (PATCH /nodes/:id { label }). */
  onLabelChange?: (nodeId: string, label: string) => void;
  /** Persist a new description on detail.summary (PATCH /nodes/:id { detail }). */
  onDescriptionChange?: (nodeId: string, summary: string) => void;
} & Record<string, unknown>;
export type PlayNodeType = Node<PlayNodeData, 'playNode'>;

type EditField = 'label' | 'description' | null;

export function PlayNode({ id, data, selected }: NodeProps<PlayNodeType>) {
  const status = data.status;
  const hasRun = status !== undefined;
  const action = data.playAction;
  const description = data.detail?.summary ?? data.kind;
  const playable = !!action && !!data.onPlay;
  const isRunning = status === 'running';
  const buttonLabel = isRunning ? 'Running…' : 'Play';
  const [isResizing, setIsResizing] = useState(false);
  const [editing, setEditing] = useState<EditField>(null);
  const sized = isResizing || data.width !== undefined || data.height !== undefined;
  const labelEditable = !!data.onLabelChange;
  const descEditable = !!data.onDescriptionChange;

  return (
    <div
      className={cn(
        'group flex flex-col rounded-lg border bg-card shadow-sm transition-shadow',
        sized ? 'h-full w-full' : 'w-[260px]',
        selected ? 'ring-2 ring-ring ring-offset-2' : '',
        isRunning ? 'anydemo-node-pulse' : '',
      )}
      data-status={status ?? 'idle'}
      data-testid="play-node"
    >
      <NodeResizer
        isVisible={selected && !!data.onResize && editing === null}
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
          {editing === 'label' && labelEditable ? (
            <InlineEdit
              initialValue={data.label}
              field="node-label"
              required
              onCommit={(v) => data.onLabelChange?.(id, v)}
              onExit={() => setEditing(null)}
              className="text-sm font-medium"
            />
          ) : (
            <button
              type="button"
              className={cn(
                'block w-full cursor-text bg-transparent p-0 text-left text-sm font-medium leading-tight',
                labelEditable ? 'hover:bg-muted/60' : '',
              )}
              onDoubleClick={
                labelEditable
                  ? (e) => {
                      e.stopPropagation();
                      setEditing('label');
                    }
                  : undefined
              }
            >
              {data.label}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasRun ? <StatusPill status={status} data-testid="play-node-status" /> : null}
          <div className="flex shrink-0 items-center justify-end gap-1" data-testid="node-actions">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!playable || isRunning}
              className="h-6 w-6 p-0"
              data-testid="play-button"
              aria-label={buttonLabel}
              title={buttonLabel}
              onClick={(e) => {
                e.stopPropagation();
                data.onPlay?.(id);
              }}
            >
              {isRunning ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Play className="h-3 w-3" aria-hidden />
              )}
            </Button>
          </div>
        </div>
      </div>
      <div className="flex-1 px-3 py-2 text-[12px] text-muted-foreground break-words">
        {editing === 'description' && descEditable ? (
          <InlineEdit
            initialValue={data.detail?.summary ?? ''}
            field="node-description"
            multiline
            onCommit={(v) => data.onDescriptionChange?.(id, v)}
            onExit={() => setEditing(null)}
            className="text-[12px]"
            placeholder={data.kind}
          />
        ) : (
          <button
            type="button"
            className={cn(
              'block w-full cursor-text bg-transparent p-0 text-left text-[12px] text-muted-foreground',
              descEditable ? 'hover:bg-muted/60' : '',
            )}
            onDoubleClick={
              descEditable
                ? (e) => {
                    e.stopPropagation();
                    setEditing('description');
                  }
                : undefined
            }
          >
            {description}
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />
    </div>
  );
}
