import { InlineEdit } from '@/components/inline-edit';
import { ResizeControls } from '@/components/nodes/resize-controls';
import { type NodeStatus, StatusPill } from '@/components/nodes/status-pill';
import { Button } from '@/components/ui/button';
import type { NodeData } from '@/lib/api';
import { colorTokenStyle } from '@/lib/color-tokens';
import { cn } from '@/lib/utils';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { Loader2, Play } from 'lucide-react';
import { type CSSProperties, useState } from 'react';

export type PlayNodeData = NodeData & {
  /**
   * Undefined when this node has no entry in the runs map (i.e. the user has
   * never clicked Play on it). Once a run is dispatched, status becomes
   * 'running' → 'done'/'error'. The pill is hidden for 'idle'.
   */
  status?: NodeStatus;
  onPlay?: (nodeId: string) => void;
  onResize?: (nodeId: string, dims: { width: number; height: number }) => void;
  setResizing?: (on: boolean) => void;
  onLabelChange?: (nodeId: string, label: string) => void;
  onDescriptionChange?: (nodeId: string, summary: string) => void;
} & Record<string, unknown>;
export type PlayNodeType = Node<PlayNodeData, 'playNode'>;

type EditField = 'label' | 'description' | null;

const MIN_W = 100;
const MIN_H = 44;
const DEFAULT_W = 200;

export function PlayNode({ id, data, selected }: NodeProps<PlayNodeType>) {
  const status = data.status;
  const action = data.playAction;
  const description = data.detail?.summary ?? data.kind;
  const playable = !!action && !!data.onPlay;
  const isRunning = status === 'running';
  const buttonLabel = isRunning ? 'Running…' : 'Play';
  const [isResizing, setIsResizing] = useState(false);
  const [editing, setEditing] = useState<EditField>(null);
  const labelEditable = !!data.onLabelChange;
  const descEditable = !!data.onDescriptionChange;
  // When data.width/height are unset and we're not mid-resize, the React Flow
  // wrapper has no explicit dims and we own sizing — pin a default width so a
  // long label/description wraps inside the node instead of stretching it.
  const sized = isResizing || data.width !== undefined || data.height !== undefined;

  // Border + background tokens are independent — picking a border color
  // shouldn't tint the background and vice versa. Unset → fall through to
  // the theme defaults baked into the 'default' token (--border / --card).
  const containerStyle: CSSProperties = {
    borderColor: colorTokenStyle(data.borderColor, 'node').borderColor,
    backgroundColor: colorTokenStyle(data.backgroundColor, 'node').backgroundColor,
    borderWidth: data.borderSize !== undefined ? data.borderSize : undefined,
    ...(sized ? {} : { width: DEFAULT_W }),
  };

  return (
    <div
      className={cn(
        'group flex flex-col justify-center overflow-hidden rounded-lg border-[3px] shadow-sm transition-shadow',
        sized ? 'h-full w-full' : '',
        selected ? 'ring-2 ring-ring ring-offset-2' : '',
        isRunning ? 'anydemo-node-pulse' : '',
      )}
      style={containerStyle}
      data-status={status ?? 'idle'}
      data-testid="play-node"
    >
      <ResizeControls
        visible={!!selected && !!data.onResize}
        minWidth={MIN_W}
        minHeight={MIN_H}
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
        className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-2 py-1"
        data-testid="node-header"
      >
        <div className="min-w-0 flex-1 text-[20px] font-normal leading-tight">
          {editing === 'label' && labelEditable ? (
            <InlineEdit
              initialValue={data.label}
              field="node-label"
              required
              onCommit={(v) => data.onLabelChange?.(id, v)}
              onExit={() => setEditing(null)}
              className="text-[20px]"
            />
          ) : (
            <button
              type="button"
              className={cn(
                'block w-full whitespace-normal break-words bg-transparent p-0 text-left text-[20px] font-normal leading-tight',
                labelEditable ? 'hover:opacity-80' : '',
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
          <StatusPill status={status ?? 'idle'} data-testid="play-node-status" />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!playable || isRunning}
            className="h-5 w-5 p-0"
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
      <div
        className="flex min-h-0 flex-1 items-center px-2 py-1"
        data-testid="node-content"
        data-resizing={isResizing ? 'true' : undefined}
      >
        {editing === 'description' && descEditable ? (
          <InlineEdit
            initialValue={data.detail?.summary ?? ''}
            field="node-description"
            multiline
            onCommit={(v) => data.onDescriptionChange?.(id, v)}
            onExit={() => setEditing(null)}
            className="w-full text-[18px] text-muted-foreground"
            placeholder={data.kind}
          />
        ) : (
          <button
            type="button"
            className={cn(
              'block w-full whitespace-normal break-words bg-transparent p-0 text-left text-[18px] text-muted-foreground',
              descEditable ? 'hover:opacity-80' : '',
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
