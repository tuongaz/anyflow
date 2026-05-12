import {
  type ControlPosition,
  NodeResizeControl,
  type OnResize,
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

// US-016: when cornerVariant === 'visible', the corner handles render as small
// white squares with a 1px primary/40 border — the same color as the outer
// selection rect drawn by the node renderer's offset outline. Slightly larger
// than the AC's ~8px because Chromium scales the visible square down by ~1px
// per side via the React Flow centering transform; 10px hits the visual mark.
const VISIBLE_CORNER_STYLE: CSSProperties = {
  width: '10px',
  height: '10px',
  background: 'hsl(var(--background))',
  border: '1px solid hsl(var(--primary) / 0.6)',
  borderRadius: '2px',
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
  /**
   * US-016: per-tick callback fired on every xyflow `onResize` event during
   * the drag (NOT just at the end). Wiring this lets node renderers update
   * canvas state live as the user drags a resize handle.
   */
  onResize?: OnResize;
  onResizeEnd?: OnResizeEnd;
  /**
   * US-016: 'visible' renders the 4 corner handles as small white squares with
   * a 1px primary/60 border — the standard design-tool selection affordance.
   * The 4 edge lines stay invisible (only their cursor + hit-area survive) so
   * "only the corners" reads visually. 'invisible' (default) keeps every
   * control transparent — affordance is purely the cursor change.
   */
  cornerVariant?: 'invisible' | 'visible';
}

// US-005: when `visible` is false, the controls stay MOUNTED (cheap) and just
// switch to non-interactive styles. Always-render avoids any unmount/remount
// thrash on `selected` flips and is the canonical pattern for any conditional
// chrome layered over a node. Visual + functional gating happens via inline
// style: pointer-events: none disables the resize cursor and drag-start;
// opacity: 0 on the visible-variant corners hides the squares.
// (The original motivation was xyflow's marquee start emitting select:false →
//  select:true synchronously, which unmounted/remounted the 8 controls each
//  cycle. US-022 removed the marquee gesture, but the always-render pattern is
//  free and still applies anywhere `selected` could transiently flip.)
const HIDDEN_OVERRIDE: CSSProperties = {
  pointerEvents: 'none',
  cursor: 'default',
};

/**
 * Eight resize controls (4 edge lines + 4 corners). Edge lines are always
 * transparent — the affordance is the cursor change at the edge. Corners are
 * either transparent (default) or visible (US-016 selection rect handles).
 * Cursor wiring is via React Flow's existing CSS classes on
 * `.react-flow__resize-control.{position}`; the visible selection rect itself
 * is drawn by the parent node renderer via an offset outline.
 */
export function ResizeControls({
  visible,
  minWidth = 80,
  minHeight = 40,
  onResizeStart,
  onResize,
  onResizeEnd,
  cornerVariant = 'invisible',
}: ResizeControlsProps) {
  const baseCornerStyle = cornerVariant === 'visible' ? VISIBLE_CORNER_STYLE : CORNER_STYLE;
  const lineStyle = (style: CSSProperties): CSSProperties =>
    visible ? style : { ...style, ...HIDDEN_OVERRIDE };
  const cornerStyle: CSSProperties = visible
    ? baseCornerStyle
    : { ...baseCornerStyle, opacity: 0, ...HIDDEN_OVERRIDE };
  return (
    <>
      {LINE_POSITIONS.map(({ position, style }) => (
        <NodeResizeControl
          key={position}
          position={position as ControlPosition}
          variant={ResizeControlVariant.Line}
          minWidth={minWidth}
          minHeight={minHeight}
          style={lineStyle(style)}
          onResizeStart={onResizeStart}
          onResize={onResize}
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
          style={cornerStyle}
          onResizeStart={onResizeStart}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        >
          <span data-testid="resize-control" data-position={position} />
        </NodeResizeControl>
      ))}
    </>
  );
}
