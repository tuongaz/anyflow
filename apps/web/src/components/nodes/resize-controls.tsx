import {
  type ControlPosition,
  NodeResizeControl,
  type OnResizeEnd,
  type OnResizeStart,
  ResizeControlVariant,
} from '@xyflow/react';
import type { CSSProperties } from 'react';

// Hit-area widths for the invisible controls. Wide enough that the cursor change
// is discoverable on hover, narrow enough not to occlude double-click targets on
// the node body (per US-031 AC).
const LINE_HIT = 8;
const CORNER_HIT = 12;

const HORIZONTAL_LINE_STYLE: CSSProperties = {
  height: `${LINE_HIT}px`,
  borderColor: 'transparent',
};
const VERTICAL_LINE_STYLE: CSSProperties = {
  width: `${LINE_HIT}px`,
  borderColor: 'transparent',
};
const CORNER_STYLE: CSSProperties = {
  width: `${CORNER_HIT}px`,
  height: `${CORNER_HIT}px`,
  background: 'transparent',
  border: 'none',
};

const LINE_POSITIONS: Array<{
  position: 'top' | 'bottom' | 'left' | 'right';
  style: CSSProperties;
}> = [
  { position: 'top', style: HORIZONTAL_LINE_STYLE },
  { position: 'bottom', style: HORIZONTAL_LINE_STYLE },
  { position: 'left', style: VERTICAL_LINE_STYLE },
  { position: 'right', style: VERTICAL_LINE_STYLE },
];

const CORNER_POSITIONS: Array<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'> = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

export interface ResizeControlsProps {
  /** Render the controls only when true (mirrors NodeResizer's isVisible). */
  visible: boolean;
  minWidth?: number;
  minHeight?: number;
  onResizeStart?: OnResizeStart;
  onResizeEnd?: OnResizeEnd;
}

/**
 * Eight invisible resize controls (4 edge lines + 4 corners). Each control is
 * fully transparent — the affordance IS the cursor change at the edges/corners
 * (ew-/ns-/nwse-/nesw-resize, wired via React Flow's existing CSS classes on
 * `.react-flow__resize-control.{position}`). The selection ring on the node
 * container stays as the selection indicator.
 */
export function ResizeControls({
  visible,
  minWidth = 80,
  minHeight = 40,
  onResizeStart,
  onResizeEnd,
}: ResizeControlsProps) {
  if (!visible) return null;
  return (
    <>
      {LINE_POSITIONS.map(({ position, style }) => (
        <NodeResizeControl
          key={position}
          position={position as ControlPosition}
          variant={ResizeControlVariant.Line}
          minWidth={minWidth}
          minHeight={minHeight}
          style={style}
          onResizeStart={onResizeStart}
          onResizeEnd={onResizeEnd}
        >
          <span data-testid="resize-control" data-position={position} />
        </NodeResizeControl>
      ))}
      {CORNER_POSITIONS.map((position) => (
        <NodeResizeControl
          key={position}
          position={position}
          variant={ResizeControlVariant.Handle}
          minWidth={minWidth}
          minHeight={minHeight}
          style={CORNER_STYLE}
          onResizeStart={onResizeStart}
          onResizeEnd={onResizeEnd}
        >
          <span data-testid="resize-control" data-position={position} />
        </NodeResizeControl>
      ))}
    </>
  );
}
