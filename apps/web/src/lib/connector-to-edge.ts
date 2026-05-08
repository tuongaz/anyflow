import type { Connector, ConnectorPath, ConnectorStyle } from '@/lib/api';
import { colorTokenStyle } from '@/lib/color-tokens';
import { type EdgeMarker, MarkerType } from '@xyflow/react';

export interface DerivedEdge {
  id: string;
  source: string;
  target: string;
  // Handle ids on the source/target nodes (US-013). Absent → React Flow
  // attaches to the first matching handle (back-compat for pre-handle demos).
  sourceHandle?: string;
  targetHandle?: string;
  type: 'editableEdge';
  label?: string;
  animated: boolean;
  // `kind` drives downstream visual filtering; per-edge runtime callbacks
  // (e.g. onLabelChange) are injected by DemoCanvas at render time so they
  // don't churn the connectorToEdge memo. `path` belongs in `data` (not
  // `style`) because it changes the SVG `d` attribute generation, not stroke
  // styling — see EditableEdge for the bezier vs smoothstep branch.
  data: { kind: Connector['kind']; path?: ConnectorPath };
  style: { strokeDasharray?: string; stroke?: string; strokeWidth?: number; opacity?: number };
  markerStart?: EdgeMarker;
  markerEnd?: EdgeMarker;
  selected?: boolean;
  // Invisible wider stroke React Flow uses for hover/click/reconnect-start
  // hit-testing. Keeps the visible stroke width unchanged while giving
  // users a comfortable buffer to grab the edge.
  interactionWidth?: number;
  // Per-edge stacking index. Set to EDGE_Z_INDEX so connectors always paint
  // above any node (nodes default to zIndex 0 in React Flow). See US-007.
  zIndex: number;
}

const EDGE_INTERACTION_WIDTH = 24;

// Closed arrowhead — width/height tuned to look balanced against the 1px stroke.
const ARROW: EdgeMarker = {
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
};

// Visual style per connector kind. Kept terse so the canvas reads cleanly:
//   • http    — solid (no dasharray)
//   • event   — dashed
//   • queue   — dotted
//   • default — solid (user-drawn, no semantic payload)
const STYLE_BY_KIND: Record<Connector['kind'], { strokeDasharray?: string }> = {
  http: {},
  event: { strokeDasharray: '6 4' },
  queue: { strokeDasharray: '2 4' },
  default: {},
};

const STYLE_BY_NAME: Record<ConnectorStyle, { strokeDasharray?: string }> = {
  solid: {},
  dashed: { strokeDasharray: '6 4' },
  dotted: { strokeDasharray: '2 4' },
};

export const styleForKind = (kind: Connector['kind']): { strokeDasharray?: string } =>
  STYLE_BY_KIND[kind];

// Selected connectors render with a thicker stroke (US-004) so the selection is
// readable at a glance against the dashed/dotted/solid kinds. We also pin
// opacity to 1 so any future muted-when-idle treatment doesn't dim the
// selected edge.
const SELECTED_STROKE_WIDTH = 3;

// Per-edge zIndex. React Flow renders nodes at zIndex 0 by default and per-node
// stacking is via array order; without this, nodes paint above edges and
// 'Send to back' (US-006) leaves the back node occluding any connector that
// crosses it (US-007). Pinning every edge above the node z-stack keeps
// connectors visible regardless of where their adjacent nodes sit in the array.
// Pair with `elevateNodesOnSelect={false}` on <ReactFlow/> (demo-canvas.tsx)
// so a selected node's +1000 elevation can't override this.
const EDGE_Z_INDEX = 1;

export const connectorToEdge = (
  connector: Connector,
  isAdjacentToRunning: boolean,
  selected = false,
): DerivedEdge => {
  // Per-connector `style` overrides the kind-derived default. This lets a
  // user-drawn 'default' connector pick up any visual style without changing
  // its (semantically empty) kind.
  const dashStyle = connector.style
    ? STYLE_BY_NAME[connector.style]
    : STYLE_BY_KIND[connector.kind];
  // Color token (defaults to 'default') drives the stroke. Letting an
  // unset color fall through to undefined would let React Flow's built-in
  // selection styling override it; setting an explicit stroke even for the
  // default token keeps the visual deterministic.
  const colorStyle = connector.color ? colorTokenStyle(connector.color, 'edge') : {};
  // Default to a heavier stroke than SVG's 1px so connectors read at canvas
  // zoom levels; per-connector borderSize overrides. Selection bumps it up
  // (max with the user's borderSize so we never thin a deliberately-bold edge).
  const baseStrokeWidth = connector.borderSize ?? 2;
  const strokeWidth = selected ? Math.max(SELECTED_STROKE_WIDTH, baseStrokeWidth) : baseStrokeWidth;
  const sizeStyle: { strokeWidth: number; opacity?: number } = selected
    ? { strokeWidth, opacity: 1 }
    : { strokeWidth };
  const style = { ...dashStyle, ...colorStyle, ...sizeStyle };
  // 'forward' (or absent) → arrow at target only (historical behavior).
  // 'backward' → arrow at source only.
  // 'both'     → arrows at both ends.
  const direction = connector.direction ?? 'forward';
  const markerStart = direction === 'backward' || direction === 'both' ? ARROW : undefined;
  const markerEnd = direction === 'forward' || direction === 'both' ? ARROW : undefined;
  return {
    id: connector.id,
    source: connector.source,
    target: connector.target,
    sourceHandle: connector.sourceHandle,
    targetHandle: connector.targetHandle,
    type: 'editableEdge',
    label: connector.label,
    animated: isAdjacentToRunning,
    data: { kind: connector.kind, path: connector.path },
    style,
    markerStart,
    markerEnd,
    interactionWidth: EDGE_INTERACTION_WIDTH,
    zIndex: EDGE_Z_INDEX,
  };
};
