import type { Connector } from '@/lib/api';

export interface DerivedEdge {
  id: string;
  source: string;
  target: string;
  type: 'smoothstep';
  label?: string;
  animated: boolean;
  data: { kind: Connector['kind'] };
  style: { strokeDasharray?: string };
}

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
});
