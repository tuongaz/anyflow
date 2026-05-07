import type { Connector } from '@/lib/api';
import { type EdgeMarker, MarkerType } from '@xyflow/react';

export interface DerivedEdge {
  id: string;
  source: string;
  target: string;
  type: 'smoothstep';
  label?: string;
  animated: boolean;
  data: { kind: Connector['kind'] };
  style: { strokeDasharray?: string };
  markerEnd: EdgeMarker;
}

// Closed arrowhead at the target end so direction (source → target) reads at
// a glance. Width/height are tuned to look balanced against the 1px stroke.
const ARROW_END: EdgeMarker = {
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
};

// Visual style per connector kind. Kept terse so the canvas reads cleanly:
//   • http  — solid (no dasharray)
//   • event — dashed
//   • queue — dotted
const STYLE_BY_KIND: Record<Connector['kind'], { strokeDasharray?: string }> = {
  http: {},
  event: { strokeDasharray: '6 4' },
  queue: { strokeDasharray: '2 4' },
};

export const styleForKind = (kind: Connector['kind']): { strokeDasharray?: string } =>
  STYLE_BY_KIND[kind];

export const connectorToEdge = (
  connector: Connector,
  isAdjacentToRunning: boolean,
): DerivedEdge => ({
  id: connector.id,
  source: connector.source,
  target: connector.target,
  type: 'smoothstep',
  label: connector.label,
  animated: isAdjacentToRunning,
  data: { kind: connector.kind },
  style: STYLE_BY_KIND[connector.kind],
  markerEnd: ARROW_END,
});
