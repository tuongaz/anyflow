import type { Connector, ConnectorStyle } from '@/lib/api';
import { colorTokenStyle } from '@/lib/color-tokens';
import { type EdgeMarker, MarkerType } from '@xyflow/react';

export interface DerivedEdge {
  id: string;
  source: string;
  target: string;
  type: 'editableEdge';
  label?: string;
  animated: boolean;
  // `kind` drives downstream visual filtering; per-edge runtime callbacks
  // (e.g. onLabelChange) are injected by DemoCanvas at render time so they
  // don't churn the connectorToEdge memo.
  data: { kind: Connector['kind'] };
  style: { strokeDasharray?: string; stroke?: string; strokeWidth?: number };
  markerStart?: EdgeMarker;
  markerEnd?: EdgeMarker;
  selected?: boolean;
}

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

export const connectorToEdge = (
  connector: Connector,
  isAdjacentToRunning: boolean,
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
  const sizeStyle: { strokeWidth?: number } =
    connector.borderSize !== undefined ? { strokeWidth: connector.borderSize } : {};
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
    type: 'editableEdge',
    label: connector.label,
    animated: isAdjacentToRunning,
    data: { kind: connector.kind },
    style,
    markerStart,
    markerEnd,
  };
};
