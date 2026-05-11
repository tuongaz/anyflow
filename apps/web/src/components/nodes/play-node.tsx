import { InlineEdit } from '@/components/inline-edit';
import { ResizeControls } from '@/components/nodes/resize-controls';
import type { NodeStatus } from '@/components/nodes/status-pill';
import { useResizeGesture } from '@/components/nodes/use-resize-gesture';
import { Button } from '@/components/ui/button';
import type { NodeData } from '@/lib/api';
import { colorTokenStyle } from '@/lib/color-tokens';
import { cn } from '@/lib/utils';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { Loader2, Play } from 'lucide-react';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, useState } from 'react';

export type PlayNodeData = NodeData & {
  /**
   * Undefined when this node has no entry in the runs map (i.e. the user has
   * never clicked Play on it). Once a run is dispatched, status becomes
   * 'running' → 'done'/'error'. Status is communicated visually via the Play
   * button itself (US-018) — no separate status chip.
   */
  status?: NodeStatus;
  /** Filled when status === 'error' — surfaced as the play-button tooltip. */
  errorMessage?: string;
  onPlay?: (nodeId: string) => void;
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  onLabelChange?: (nodeId: string, label: string) => void;
  onDescriptionChange?: (nodeId: string, summary: string) => void;
} & Record<string, unknown>;
export type PlayNodeType = Node<PlayNodeData, 'playNode'>;

type EditField = 'label' | 'description' | null;

const MIN_W = 100;
const MIN_H = 44;
const DEFAULT_W = 200;

export function PlayNode({ id, data, selected, isConnectable }: NodeProps<PlayNodeType>) {
  const status = data.status;
  const action = data.playAction;
  const description = data.detail?.summary ?? data.kind;
  const playable = !!action && !!data.onPlay;
  const isRunning = status === 'running';
  const isError = status === 'error';
  // US-018: failed runs surface their reason as the button tooltip — replaces
  // the removed status chip. Falls back to a generic "Failed" if the SSE
  // event arrived without a message.
  const buttonLabel = isRunning
    ? 'Running…'
    : isError
      ? data.errorMessage
        ? `Failed: ${data.errorMessage}`
        : 'Failed'
      : 'Play';
  const { isResizing, onResizeStart, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing,
  });
  const [editing, setEditing] = useState<EditField>(null);
  const labelEditable = !!data.onLabelChange;
  const descEditable = !!data.onDescriptionChange;
  // When data.width/height are unset and we're not mid-resize, the React Flow
  // wrapper has no explicit dims and we own sizing — pin a default width so a
  // long label/description wraps inside the node instead of stretching it.
  const sized = isResizing || data.width !== undefined || data.height !== undefined;
  // US-008: title and body now share the same font size — title is bolded
  // instead of larger. The Style-tab fontSize override applies equally to
  // both, so a user-set 28px bumps the title AND the body to 28px.
  const labelFontStyle: CSSProperties =
    data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {};
  const descriptionFontStyle: CSSProperties = labelFontStyle;

  // Border + background tokens are independent — picking a border color
  // shouldn't tint the background and vice versa. Unset → fall through to
  // the theme defaults baked into the 'default' token (--border / --card).
  // US-016: selection draws a thin (1px), low-contrast outer rectangle 4px
  // outside the node — the standard design-tool selection box. Outline is
  // used (not a wider border or absolute overlay) so layout never shifts —
  // play-nodes have content-driven height when not yet user-resized, so
  // growing border-width would push the outer height. The four corner
  // resize handles render at the node's own corners; with the 4px outline
  // offset, the visible 10px white squares sit at the rect's corners.
  const containerStyle: CSSProperties = {
    borderColor: colorTokenStyle(data.borderColor, 'node').borderColor,
    backgroundColor: colorTokenStyle(data.backgroundColor, 'node').backgroundColor,
    borderWidth: data.borderSize !== undefined ? data.borderSize : undefined,
    borderStyle: data.borderStyle,
    borderRadius: data.cornerRadius !== undefined ? data.cornerRadius : undefined,
    ...(sized ? {} : { width: DEFAULT_W }),
    ...(selected
      ? {
          outlineWidth: '1px',
          outlineStyle: 'solid',
          outlineColor: 'hsl(var(--primary) / 0.4)',
          outlineOffset: '4px',
        }
      : {}),
  };

  // US-020: region-aware double-click routing. Header → label edit; content
  // body (including blank space below short text) → description edit; padding
  // outside both falls back to description (when editable) so a tall node with
  // an empty description still routes blank-area clicks to the description.
  // Bails out for handles + resize controls so connect/resize gestures keep
  // their drag semantics. No-op while ANY field is already editing — InlineEdit
  // also stops propagation so a stray dblclick mid-edit doesn't switch fields.
  const handleWrapperDoubleClick =
    labelEditable || descEditable
      ? (e: ReactMouseEvent<HTMLDivElement>) => {
          if (editing !== null) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('.react-flow__handle')) return;
          if (target?.closest('.react-flow__resize-control')) return;
          e.stopPropagation();
          if (target?.closest('[data-testid="node-header"]')) {
            if (labelEditable) setEditing('label');
            return;
          }
          if (target?.closest('[data-testid="node-content"]')) {
            if (descEditable) setEditing('description');
            else if (labelEditable) setEditing('label');
            return;
          }
          if (descEditable) setEditing('description');
          else if (labelEditable) setEditing('label');
        }
      : undefined;

  return (
    <div
      className={cn(
        'group flex flex-col justify-center overflow-hidden rounded-lg border-[3px] shadow-sm transition-shadow',
        sized ? 'h-full w-full' : '',
        isRunning ? 'anydemo-node-pulse' : '',
      )}
      style={containerStyle}
      data-status={status ?? 'idle'}
      data-testid="play-node"
      onDoubleClick={handleWrapperDoubleClick}
    >
      <ResizeControls
        visible={!!selected && !!data.onResize}
        cornerVariant="visible"
        minWidth={MIN_W}
        minHeight={MIN_H}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="t"
        isConnectable={isConnectable}
        className={cn('opacity-0 transition-opacity', selected && '!opacity-100')}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        isConnectable={isConnectable}
        className={cn('opacity-0 transition-opacity', selected && '!opacity-100')}
      />
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-2 py-2"
        data-testid="node-header"
      >
        <div
          className="min-w-0 flex-1 text-[18px] font-semibold leading-tight"
          style={labelFontStyle}
        >
          {editing === 'label' && labelEditable ? (
            <InlineEdit
              initialValue={data.label}
              field="node-label"
              required
              commitMode="blur-only"
              onCommit={(v) => data.onLabelChange?.(id, v)}
              onExit={() => setEditing(null)}
              className="text-[18px] font-semibold"
              style={labelFontStyle}
            />
          ) : (
            <button
              type="button"
              className={cn(
                'block w-full whitespace-pre-wrap break-words bg-transparent p-0 text-left text-[18px] font-semibold leading-tight',
                labelEditable ? 'hover:opacity-80' : '',
              )}
              style={labelFontStyle}
            >
              {data.label}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!playable || isRunning}
            // US-018: circular play button. On error, a thick red border
            // wraps the circle — replaces the standalone status chip. The
            // play glyph (or running spinner) stays visible inside.
            className={cn(
              'h-8 w-8 rounded-full p-0',
              isError && 'border-2 border-rose-500 dark:border-rose-400',
            )}
            data-testid="play-button"
            data-status={status ?? 'idle'}
            aria-label={buttonLabel}
            title={buttonLabel}
            onClick={(e) => {
              e.stopPropagation();
              data.onPlay?.(id);
            }}
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="h-4 w-4" aria-hidden />
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
            style={descriptionFontStyle}
            placeholder={data.kind}
          />
        ) : (
          <button
            type="button"
            className={cn(
              'block w-full whitespace-normal break-words bg-transparent p-0 text-left text-[18px] text-muted-foreground',
              descEditable ? 'hover:opacity-80' : '',
            )}
            style={descriptionFontStyle}
          >
            {description}
          </button>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        isConnectable={isConnectable}
        className={cn('opacity-0 transition-opacity', selected && '!opacity-100')}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        isConnectable={isConnectable}
        className={cn('opacity-0 transition-opacity', selected && '!opacity-100')}
      />
    </div>
  );
}
