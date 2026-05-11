import type { OnResizeEnd, OnResizeStart, ResizeParams } from '@xyflow/react';
import { useRef, useState } from 'react';

/**
 * Wraps a NodeResizeControl gesture so a click on a resize handle (mousedown
 * + mouseup with no movement) is a no-op. React Flow fires onResizeStart AND
 * onResizeEnd unconditionally — without this guard, a click would call
 * data.onResize with the current measured dims, promoting a previously
 * unsized node to a sized one and visibly expanding it.
 */
export function useResizeGesture(args: {
  onResize?: (dims: ResizeParams) => void;
  setResizing?: (on: boolean) => void;
}) {
  const { onResize, setResizing } = args;
  const [isResizing, setIsResizing] = useState(false);
  const startRef = useRef<ResizeParams | null>(null);

  const onResizeStart: OnResizeStart = (_e, params) => {
    setIsResizing(true);
    setResizing?.(true);
    startRef.current = params
      ? { x: params.x, y: params.y, width: params.width, height: params.height }
      : null;
  };

  const onResizeEnd: OnResizeEnd = (_e, params) => {
    setIsResizing(false);
    setResizing?.(false);
    const start = startRef.current;
    startRef.current = null;
    // No movement → treat as click, don't persist. Size equality is the
    // primary signal; corner handles can nudge x/y a sub-pixel without a
    // real resize, so we gate on width+height equality only.
    if (start && start.width === params.width && start.height === params.height) {
      return;
    }
    onResize?.({ x: params.x, y: params.y, width: params.width, height: params.height });
  };

  return { isResizing, onResizeStart, onResizeEnd };
}
