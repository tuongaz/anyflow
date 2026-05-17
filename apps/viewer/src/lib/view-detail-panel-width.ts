export const VIEWER_DETAIL_PANEL_WIDTH_KEY = 'seeflow:viewer-detail-panel-width';

export const DEFAULT = 360;
export const MIN = 280;
export const MAX = 700;

export function clamp(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT;
  if (value < MIN) return MIN;
  if (value > MAX) return MAX;
  return value;
}

export function getStored(): number {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const raw = window.localStorage.getItem(VIEWER_DETAIL_PANEL_WIDTH_KEY);
    if (raw === null) return DEFAULT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT;
    if (parsed < MIN || parsed > MAX) return DEFAULT;
    return parsed;
  } catch {
    return DEFAULT;
  }
}

export function setStored(width: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEWER_DETAIL_PANEL_WIDTH_KEY, String(clamp(width)));
  } catch {
    // localStorage may be unavailable (private mode, quota, etc.) — non-fatal.
  }
}

export interface ResizeGestureCallbacks {
  onWidth: (next: number) => void;
  onCommit: (final: number) => void;
}

interface ResizeGestureTarget {
  addEventListener: (event: string, cb: (e: { clientX: number }) => void) => void;
  removeEventListener: (event: string, cb: (e: { clientX: number }) => void) => void;
}

export function startResizeGesture(
  startWidth: number,
  startClientX: number,
  callbacks: ResizeGestureCallbacks,
  target?: ResizeGestureTarget,
): void {
  const win: ResizeGestureTarget | null =
    target ?? (typeof window === 'undefined' ? null : (window as unknown as ResizeGestureTarget));
  if (!win) return;
  let current = clamp(startWidth);
  const onMove = (e: { clientX: number }) => {
    current = clamp(startWidth + (startClientX - e.clientX));
    callbacks.onWidth(current);
  };
  const onUp = () => {
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
    win.removeEventListener('pointercancel', onUp);
    callbacks.onCommit(current);
  };
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', onUp);
  win.addEventListener('pointercancel', onUp);
}
