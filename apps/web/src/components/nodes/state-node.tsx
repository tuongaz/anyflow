import { InlineEdit } from '@/components/inline-edit';
import { ResizeControls } from '@/components/nodes/resize-controls';
import { type NodeStatus, StatusPill } from '@/components/nodes/status-pill';
import type { NodeData } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { useState } from 'react';

export type StateNodeData = NodeData & {
  /**
   * Undefined when no emit() event has landed for this node — treated as
   * 'idle' visually. Unlike PlayNode, StateNode always renders its pill
   * (per US-030: "StateNode's existing StatusPill behavior is unaffected").
   */
  status?: NodeStatus;
  onResize?: (nodeId: string, dims: { width: number; height: number }) => void;
  setResizing?: (on: boolean) => void;
  onLabelChange?: (nodeId: string, label: string) => void;
  onDescriptionChange?: (nodeId: string, summary: string) => void;
} & Record<string, unknown>;
export type StateNodeType = Node<StateNodeData, 'stateNode'>;

type EditField = 'label' | 'description' | null;

export function StateNode({ id, data, selected }: NodeProps<StateNodeType>) {
  const status = data.status ?? 'idle';
  const description = data.detail?.summary ?? data.kind;
  const [isResizing, setIsResizing] = useState(false);
  const [editing, setEditing] = useState<EditField>(null);
  const sized = isResizing || data.width !== undefined || data.height !== undefined;
  const labelEditable = !!data.onLabelChange;
  const descEditable = !!data.onDescriptionChange;

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
      <ResizeControls
        visible={!!selected && !!data.onResize && editing === null}
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
          <StatusPill status={status} />
          <div
            className="flex shrink-0 items-center justify-end gap-1"
            data-testid="node-actions"
          />
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
