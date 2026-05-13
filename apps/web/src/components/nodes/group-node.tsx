import { InlineEdit } from '@/components/inline-edit';
import { LockBadge } from '@/components/nodes/lock-badge';
import { ResizeControls } from '@/components/nodes/resize-controls';
import { useResizeGesture } from '@/components/nodes/use-resize-gesture';
import type { GroupNodeData } from '@/lib/api';
import { colorTokenStyle } from '@/lib/color-tokens';
import { cn } from '@/lib/utils';
import type { Node, NodeProps } from '@xyflow/react';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  memo,
  useState,
} from 'react';

export type GroupNodeRuntimeData = GroupNodeData & {
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  /**
   * End-only resize hook. Fires once at mouse release with the FINAL dims and
   * the START dims (the group's bounds at the moment the gesture began). The
   * canvas uses this to scale children proportionally against the captured
   * start rect — deferred to release so per-tick optimistic overrides can't
   * feed back into the next tick's baseline (the exponential expand/shrink
   * bug that killed the previous per-tick scaling path).
   */
  onResizeFinal?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
    start: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  // Persist the inline-edited name via the shared PATCH path. Reuses
  // demo-view.tsx's `onNodeNameChange`, which coalesces under
  // `node:<id>:name` so a typing session produces a single undo entry.
  // Absent → clicks on the slot are a no-op (read-only contexts).
  onNameChange?: (nodeId: string, name: string) => void;
  // True when the user has entered this group via double-click. CSS styles
  // `[data-active="true"]` to give the group a stronger chrome so the user
  // can tell which group is currently editable. Undefined / false → idle
  // (normal dashed border).
  isActive?: boolean;
} & Record<string, unknown>;
export type GroupNodeType = Node<GroupNodeRuntimeData, 'group'>;

// US-011: minimum dimensions for a group. Wide enough to host the label slot
// at a comfortable size and deep enough to contain a typical labeled child.
const MIN_W = 120;
const MIN_H = 80;
export const GROUP_DEFAULT_SIZE = { width: 320, height: 220 } as const;

// US-011: label slot height. Reserved at the top of the group's bounding box
// so children whose `parentId` points at the group don't visually collide with
// the label text. ~28px matches the AC's "empty ~28px tall strip" requirement.
const LABEL_SLOT_HEIGHT = 28;

// US-005: resolve persisted style fields into an inline CSSProperties block.
// Only includes the keys that are actually set in `data` so the default CSS
// chrome (.react-flow__node-group: 1px dashed border, transparent fill) keeps
// applying for the unset axes. Color tokens are resolved via colorTokenStyle
// (same path shape-node uses). `borderWidth` is the PRD-canonical name (NOT
// `borderSize` — that's the shape-node spelling).
export function groupChromeStyle(
  data: Pick<GroupNodeData, 'backgroundColor' | 'borderColor' | 'borderWidth' | 'borderStyle'>,
): CSSProperties {
  const style: CSSProperties = {};
  if (data.backgroundColor !== undefined) {
    style.backgroundColor = colorTokenStyle(data.backgroundColor, 'node').backgroundColor;
  }
  if (data.borderColor !== undefined) {
    style.borderColor = colorTokenStyle(data.borderColor, 'node').borderColor;
  }
  if (data.borderWidth !== undefined) {
    style.borderWidth = data.borderWidth;
  }
  if (data.borderStyle !== undefined) {
    style.borderStyle = data.borderStyle;
  }
  return style;
}

function GroupNodeImpl({ id, data, selected }: NodeProps<GroupNodeType>) {
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeFinal: (dims, start) => data.onResizeFinal?.(id, dims, start),
    setResizing: data.setResizing,
  });
  // Once user-resized (or pre-sized via authoring), the React Flow wrapper
  // owns dimensions and the inner fills via h-full w-full. Before any resize,
  // we pin a default size so the wrapper auto-sizes to it.
  const sized = isResizing || data.width !== undefined || data.height !== undefined;
  const nameEditable = !!data.onNameChange;
  const [isEditing, setIsEditing] = useState(false);

  // US-014: clicking the label slot enters inline-edit mode (mirrors US-004's
  // iconNode dblclick → label-edit binding, but `click` is the gesture here
  // because the slot is a dedicated affordance — the group body is otherwise
  // empty so click-to-edit doesn't collide with any other action). No-op when
  // label edits aren't wired (e.g. readonly demos).
  const handleLabelClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!nameEditable || isEditing) return;
    e.stopPropagation();
    setIsEditing(true);
  };
  // Keyboard parity: Enter/Space on the focused slot triggers the same edit
  // entry as a click. React Flow keeps the node container itself focusable;
  // the slot inherits focus through the wrapper's tabIndex.
  const handleLabelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!nameEditable || isEditing) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    setIsEditing(true);
  };

  // Chrome (dashed border, transparent fill, selected outline) lives in CSS
  // (.react-flow__node-group rules in apps/web/src/index.css) so this
  // component's render stays minimal and theme/style changes don't touch JSX.
  // US-005: when `data` provides any of the persisted style fields
  // (backgroundColor / borderColor / borderWidth / borderStyle), the resolved
  // values are merged onto the outer div's inline style so they win over the
  // CSS defaults via specificity. Unset fields fall through to the CSS chrome.
  const chromeStyle = groupChromeStyle(data);
  const hasChromeStyle = Object.keys(chromeStyle).length > 0;
  const sizeStyle: CSSProperties | null = sized
    ? null
    : { width: GROUP_DEFAULT_SIZE.width, height: GROUP_DEFAULT_SIZE.height };
  const inlineStyle: CSSProperties | undefined =
    sizeStyle || hasChromeStyle ? { ...(sizeStyle ?? {}), ...chromeStyle } : undefined;
  return (
    <div
      className={cn('relative', sized ? 'h-full w-full' : '')}
      data-testid="group-node"
      data-label={data.name && data.name.length > 0 ? data.name : undefined}
      data-active={data.isActive ? 'true' : undefined}
      style={inlineStyle}
    >
      <ResizeControls
        visible={!!selected && !!data.onResize && !isEditing && !data.locked}
        cornerVariant="visible"
        minWidth={MIN_W}
        minHeight={MIN_H}
        onResizeStart={onResizeStart}
        onResize={onResizeEvent}
        onResizeEnd={onResizeEnd}
      />
      {data.locked ? <LockBadge /> : null}
      <div
        className={cn(
          'react-flow__node-group-label',
          nameEditable && !isEditing ? 'cursor-text' : '',
        )}
        data-testid="group-node-label"
        data-editing={isEditing ? 'true' : undefined}
        style={{ height: LABEL_SLOT_HEIGHT }}
        onClick={handleLabelClick}
        onKeyDown={handleLabelKeyDown}
        role={nameEditable && !isEditing ? 'button' : undefined}
        tabIndex={nameEditable && !isEditing ? 0 : undefined}
      >
        {isEditing && nameEditable ? (
          <InlineEdit
            initialValue={data.name ?? ''}
            field="group-node-name"
            onCommit={(v) => data.onNameChange?.(id, v)}
            onExit={() => setIsEditing(false)}
            placeholder="Group label"
          />
        ) : data.name && data.name.length > 0 ? (
          data.name
        ) : null}
      </div>
    </div>
  );
}

// US-010 / US-011: see play-node.tsx — skip re-renders on xyflow's internal
// prop ticks (dragging, isConnectable, xPos/yPos) so a marquee gesture or a
// child drag doesn't churn the group's render.
function arePropsEqual(prev: NodeProps<GroupNodeType>, next: NodeProps<GroupNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const GroupNode = memo(GroupNodeImpl, arePropsEqual);
