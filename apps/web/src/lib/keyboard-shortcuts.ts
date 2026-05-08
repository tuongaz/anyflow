// Pure helpers for the canvas keyboard shortcuts (US-024). Kept ref-free so
// they can be unit-tested without DOM/React: each takes the bare event fields
// the dispatcher reads and returns the resolved action (or null for unrelated
// keys). Wiring lives in `demo-view.tsx`.

export type ModifierEvent = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'
>;

export type NudgeDelta = { dx: number; dy: number };

const NUDGE_STEP_DEFAULT = 1;
const NUDGE_STEP_SHIFT = 10;

/**
 * Resolve an arrow-key nudge from a KeyboardEvent. Returns null for any other
 * key, OR for arrows accompanied by a non-shift modifier (so Cmd+ArrowRight
 * etc. fall through to the browser's word-jump / line-jump behavior).
 *
 * Shift increases the step from 1px to 10px on the same axis. Up/Down map to
 * y±1 (canvas y grows downward); Left/Right map to x±1.
 */
export const getNudgeDelta = (e: ModifierEvent): NudgeDelta | null => {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const step = e.shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP_DEFAULT;
  switch (e.key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    default:
      return null;
  }
};

export type ZoomAction = 'fit' | 'in' | 'out';

/**
 * Resolve a Cmd/Ctrl-prefixed zoom chord. Cmd+0 → fit, Cmd+= or Cmd+Plus → in,
 * Cmd+- → out. Returns null for unrelated keys or chords without the
 * Cmd/Ctrl modifier. Alt as an extra modifier disqualifies the chord (avoids
 * shadowing the browser's Cmd+Alt+= and similar developer shortcuts).
 */
export const getZoomChord = (e: ModifierEvent): ZoomAction | null => {
  if (!(e.metaKey || e.ctrlKey)) return null;
  if (e.altKey) return null;
  switch (e.key) {
    case '0':
      return 'fit';
    // '=' is the bare key, '+' is Shift+= on most layouts. Both should map to
    // zoom in so Cmd+= and Cmd+Shift+= behave the same.
    case '=':
    case '+':
      return 'in';
    // '-' is the bare key, '_' is Shift+- on most layouts. Pair them so
    // Cmd+- and Cmd+Shift+- both zoom out.
    case '-':
    case '_':
      return 'out';
    default:
      return null;
  }
};

/**
 * Compute the per-id position updates produced by an arrow-key nudge against
 * the current selection. Skips ids that aren't in `nodes` so a pure-connector
 * selection (no node ids supplied) collapses to a no-op the caller can detect
 * via `result.length === 0`.
 *
 * `nodes` carries the LIVE position the user sees (overrides merged) so a
 * burst of arrow taps within the undo coalesce window keeps stacking on the
 * already-shifted position rather than the stale server snapshot.
 */
export const applyNudge = (
  delta: NudgeDelta,
  selectedIds: readonly string[],
  nodes: readonly { id: string; position: { x: number; y: number } }[],
): { id: string; position: { x: number; y: number } }[] => {
  if (selectedIds.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: { id: string; position: { x: number; y: number } }[] = [];
  for (const id of selectedIds) {
    const n = byId.get(id);
    if (!n) continue;
    out.push({
      id,
      position: { x: n.position.x + delta.dx, y: n.position.y + delta.dy },
    });
  }
  return out;
};
