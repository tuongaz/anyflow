import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// US-015: connector label sits ABOVE the connector line.
//
// Two invariants pin the fix in place across future refactors:
//
//   1. `.react-flow__edgelabel-renderer` (xyflow's portal container that
//      receives every <EdgeLabelRenderer> child) MUST carry a z-index
//      higher than the per-edge SVG inline z-index (1, set via
//      DEFAULT_EDGE_OPTIONS in demo-canvas.tsx). Without this rule labels
//      paint via DOM-order auto-stacking and the SVG path layers above
//      the label, so the line visibly crosses through the text.
//
//   2. The label markup in editable-edge.tsx MUST render an OPAQUE
//      background plate when label text is present, so even if a future
//      stacking change reintroduces overlap the line stays masked
//      cleanly behind the text. `bg-background` (theme background token)
//      is the agreed plate; an empty label renders no plate at all so
//      the canvas keeps no ghost artifact.
const repoRoot = join(import.meta.dir, '..', '..', '..', '..', '..');
const indexCssPath = join(repoRoot, 'apps/web/src/index.css');
const editableEdgePath = join(repoRoot, 'apps/web/src/components/edges/editable-edge.tsx');

describe('US-015: connector label paints above edge line', () => {
  it('index.css raises .react-flow__edgelabel-renderer z-index above per-edge zIndex (1)', () => {
    const css = readFileSync(indexCssPath, 'utf-8');
    const rule = css.match(/\.react-flow__edgelabel-renderer\s*\{[^}]*z-index:\s*(\d+)[^}]*\}/);
    expect(rule).not.toBeNull();
    if (!rule) throw new Error('expected .react-flow__edgelabel-renderer z-index rule');
    const zIndex = Number(rule[1]);
    // Per-edge SVG paints with inline `z-index: 1` (DEFAULT_EDGE_OPTIONS in
    // demo-canvas.tsx). Label container must outrank that.
    expect(zIndex).toBeGreaterThan(1);
    // Sanity ceiling: must not exceed the connector endpoint dot z-index
    // (2000, US-024) — those dots are a higher-priority affordance.
    expect(zIndex).toBeLessThan(2000);
  });

  it('label markup uses opaque bg-background plate when text is present', () => {
    const src = readFileSync(editableEdgePath, 'utf-8');
    // The label-display branch (`labelText ? <button …` JSX) renders the
    // visible label plate. It must use `bg-background` (opaque theme token)
    // so the connector path is masked behind the text. Past regressions
    // used `bg-card` which is semi-transparent and let the line bleed —
    // history called out in the bg-background comment.
    expect(src).toMatch(/bg-background/);
    // Strip JS comments before scanning so the historical "bg-card"
    // mention in the bg-background callout doesn't trip the fence.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).not.toMatch(/\bbg-card\b/);
  });

  it('inline-edit branch also uses opaque bg-background plate', () => {
    const src = readFileSync(editableEdgePath, 'utf-8');
    // Two label-bearing branches share the same `bg-background` className:
    // the read-only `<button>` (text present) and the inline editor
    // (`<InlineEdit>` while editing). Count the bg-background occurrences
    // to ensure both branches still carry the plate. The empty-label
    // affordance ('+' button) also uses bg-background to mask the line
    // when hovered visible.
    const matches = src.match(/bg-background/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('empty-label state renders no extra visual artifact (no opaque plate when text absent + non-editable)', () => {
    const src = readFileSync(editableEdgePath, 'utf-8');
    // The non-editable + empty-label branch returns null so the label
    // portal stays empty — no ghost plate over the line. Verify by
    // checking the trailing branch ends with `: null`.
    expect(src).toMatch(/:\s*editable\s*\?[\s\S]*?:\s*null/);
  });
});

// The visible endpoint dot must be purely visual so React Flow's native
// EdgeUpdateAnchors (which sit at the same screen position) can drive the
// free-floating reconnect drag. A previous iteration added a custom
// mousedown handler that clamped the drag to the node's perimeter —
// "snapped to the node" rather than following the cursor — and broke the
// reattach-to-another-node flow. Two invariants prevent that regression:
//
//   1. The dot's CSS rule sets `pointer-events: none` so clicks pass
//      through to the underlying anchor.
//   2. The dot element in editable-edge.tsx carries no `onMouseDown` /
//      `onContextMenu` / drag handler — it's a `<div>` with className and
//      transform only.
describe('endpoint dot is visual-only — native React Flow reconnect drives drag', () => {
  it('CSS sets pointer-events: none on the endpoint dot', () => {
    const css = readFileSync(indexCssPath, 'utf-8');
    const rule = css.match(/\.anydemo-connector-endpoint-dot\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    if (!rule) throw new Error('expected .anydemo-connector-endpoint-dot rule');
    expect(rule[0]).toMatch(/pointer-events:\s*none/);
    // The `cursor: grab` / `grabbing` affordances from the perimeter-snap
    // era would imply a drag handler on the dot. They must be gone.
    expect(rule[0]).not.toMatch(/cursor:\s*grab/);
  });

  it('editable-edge.tsx attaches no mouse handlers to the dot', () => {
    const src = readFileSync(editableEdgePath, 'utf-8');
    // The dot was previously the click target for a perimeter pin-drag
    // gesture. Restoring free drag requires the dot to be inert — clicks
    // must fall through to React Flow's EdgeUpdateAnchors below.
    expect(src).not.toMatch(/onPinDragStart/);
    expect(src).not.toMatch(/onMouseDown=\{[^}]*onPin/);
    expect(src).not.toMatch(/setDragPreview/);
    expect(src).not.toMatch(/document\.elementsFromPoint/);
  });
});
