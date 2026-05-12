import type { OnResize, OnResizeEnd, OnResizeStart, ResizeParams } from '@xyflow/react';
import { useRef, useState } from 'react';

/**
 * Wraps a NodeResizeControl gesture so a click on a resize handle (mousedown
 * + mouseup with no movement) is a no-op. React Flow fires onResizeStart AND
 * onResizeEnd unconditionally — without this guard, a click would call
 * data.onResize with the current measured dims, promoting a previously
 * unsized node to a sized one and visibly expanding it.
 *
 * US-016: also exposes an `onResize` (per-tick) handler that fires the user's
 * `onResize` callback on every xyflow resize tick — so child nodes / overlay
 * payloads update LIVE during the drag, not just on release. The same
 * callback is invoked at `onResizeEnd` (back-compat: existing tests + the
 * click-guard branch still flow through there). The end-fired call carries
 * the SAME dims as the last per-tick call, so demo-view's optimistic
 * overrides + the coalesced undo key make the redundant dispatch a no-op
 * visually (one undo entry per gesture; PATCHes are idempotent on the
 * server).
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

  // US-016: per-tick handler — fires `onResize` on every xyflow tick so the
  // canvas (and any group children / multi-select overlay) updates live.
  const onResizeEvent: OnResize = (_e, params) => {
    onResize?.({ x: params.x, y: params.y, width: params.width, height: params.height });
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
    // US-016: per-tick handler already dispatched the final dims during the
    // gesture. The end-fired call is redundant when ticks have run, but kept
    // for back-compat with tests + the unlikely "no per-tick, only end"
    // path. Same-dims dispatch is idempotent under the coalesced-undo +
    // overrides design — no visual double-update.
    onResize?.({ x: params.x, y: params.y, width: params.width, height: params.height });
  };

  return { isResizing, onResizeStart, onResizeEvent, onResizeEnd };
}
