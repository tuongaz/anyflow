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

// Endpoint-dot drag must support reattaching the dragged endpoint to a
// DIFFERENT node, not just sliding along the current node's perimeter. The
// hit-test walks elementsFromPoint each mousemove and, when the cursor lies
// over a foreign node, the live preview anchors against that node and
// pointer-up dispatches onReconnectEndpointToNode (rather than onPinEndpoint).
// Two source-level invariants pin the behaviour:
//
//   1. The drag move handler reads the node under the cursor via
//      `elementsFromPoint` + `.closest('.react-flow__node')`. Without this,
//      the cursor can never escape the original node's box.
//
//   2. The pointer-up branch dispatches `onReconnectEndpointToNode` when the
//      finalized drag target is a different node from the endpoint's own
//      node. A single same-node dispatcher (`onPinEndpoint` only) would
//      collapse the foreign-node case back to a perimeter-pin.
describe('endpoint-dot drag reattaches to a different node', () => {
  it('move handler hit-tests elementsFromPoint for the cursor node', () => {
    const src = readFileSync(editableEdgePath, 'utf-8');
    // The drag move callback must look up which node lies under the cursor
    // — without this lookup the gesture stays clamped to the original node.
    expect(src).toMatch(/document\.elementsFromPoint/);
    expect(src).toMatch(/\.closest\?\.\(['"]\.react-flow__node['"]\)/);
  });

  it('drag preview state carries the destination node id, not just the pin', () => {
    const src = readFileSync(editableEdgePath, 'utf-8');
    // The state shape must include `nodeId` so the renderer can swap the
    // bbox used for resolveEdgeEndpoints when the cursor crosses onto a
    // foreign node. A `{ kind, pin }`-only shape would lose the
    // information needed to render the preview against the new node.
    expect(src).toMatch(/setDragPreview\(\{\s*kind,\s*nodeId:\s*\w+,\s*pin\s*\}\)/);
    // And the useState shape itself must declare the nodeId field.
    expect(src).toMatch(/useState<\{[\s\S]*?nodeId:\s*string;[\s\S]*?pin:\s*Pin/);
  });

  it('pointer-up dispatches onReconnectEndpointToNode when the target node differs', () => {
    const src = readFileSync(editableEdgePath, 'utf-8');
    // The pointer-up branch must call onReconnectEndpointToNode when the
    // final drop is over a foreign node — without this, the gesture
    // silently degrades to a same-node pin.
    expect(src).toMatch(
      /onReconnectEndpointToNode\?\.\(id,\s*kind,\s*final\.nodeId,\s*final\.pin\)/,
    );
    // …and call onPinEndpoint for the same-node branch (the perimeter-pin
    // affordance still works).
    expect(src).toMatch(/onPinEndpoint\?\.\(id,\s*kind,\s*final\.pin\)/);
  });

  it('move handler rejects the other endpoint node (no self-loop preview)', () => {
    const src = readFileSync(editableEdgePath, 'utf-8');
    // Dragging the source endpoint onto the target node (or vice versa)
    // would create a self-loop. The preview path must refuse to switch to
    // the other endpoint's node so the user can't even visually flick
    // onto it.
    expect(src).toMatch(/otherEndpointNodeId/);
  });
});
