import { describe, expect, it } from 'bun:test';
import type { Connector } from '@/lib/api';
import { connectorToEdge, styleForKind } from '@/lib/connector-to-edge';
import { MarkerType } from '@xyflow/react';

describe('connectorToEdge', () => {
  it('preserves id/source/target and uses the editableEdge custom type', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'http',
      method: 'POST',
      url: 'http://b/',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.id).toBe('c1');
    expect(edge.source).toBe('a');
    expect(edge.target).toBe('b');
    expect(edge.type).toBe('editableEdge');
  });

  it('passes the connector label through to the React Flow edge label', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'event',
      eventName: 'todo.completed',
      label: 'publishes todo.completed',
    };
    expect(connectorToEdge(c, false).label).toBe('publishes todo.completed');
  });

  it('flips animated:true when adjacent to a running node', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'event', eventName: 'x.y' };
    expect(connectorToEdge(c, true).animated).toBe(true);
    expect(connectorToEdge(c, false).animated).toBe(false);
  });

  it('styles edges by kind: solid http, dashed event, dotted queue', () => {
    expect(styleForKind('http')).toEqual({});
    expect(styleForKind('event')).toEqual({ strokeDasharray: '6 4' });
    expect(styleForKind('queue')).toEqual({ strokeDasharray: '2 4' });
  });

  it('renders a closed arrowhead at the target so direction reads at a glance', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'http',
      method: 'GET',
      url: 'http://b/',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.markerEnd?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.markerStart).toBeUndefined();
  });

  it('preserves the connector kind in edge data for downstream filtering', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'queue',
      queueName: 'work-queue',
    };
    expect(connectorToEdge(c, false).data.kind).toBe('queue');
  });

  it('renders a default connector as solid (no dasharray)', () => {
    expect(styleForKind('default')).toEqual({});
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const edge = connectorToEdge(c, false);
    expect(edge.style.strokeDasharray).toBeUndefined();
    expect(edge.style.strokeWidth).toBe(2);
  });

  it('lets per-connector style override the kind-derived style', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'http',
      style: 'dashed',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.style.strokeDasharray).toBe('6 4');
    expect(edge.style.strokeWidth).toBe(2);
  });

  it('uses connector.borderSize as strokeWidth when set', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      borderSize: 5,
    };
    expect(connectorToEdge(c, false).style.strokeWidth).toBe(5);
  });

  it('places markerStart only when direction is backward', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      direction: 'backward',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.markerStart?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.markerEnd).toBeUndefined();
  });

  it('places markerStart and markerEnd when direction is both', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      direction: 'both',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.markerStart?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.markerEnd?.type).toBe(MarkerType.ArrowClosed);
  });

  it('treats absent direction as forward (markerEnd only)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const edge = connectorToEdge(c, false);
    expect(edge.markerEnd?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.markerStart).toBeUndefined();
  });

  it('sets a 24px interactionWidth so the edge has a wider hit area for hover/click/reconnect', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    expect(connectorToEdge(c, false).interactionWidth).toBe(24);
  });

  it('passes sourceHandle/targetHandle through to the React Flow edge (US-013)', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      sourceHandle: 'b',
      targetHandle: 't',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.sourceHandle).toBe('b');
    expect(edge.targetHandle).toBe('t');
  });

  it('leaves sourceHandle/targetHandle undefined for connectors authored without handle ids', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const edge = connectorToEdge(c, false);
    expect(edge.sourceHandle).toBeUndefined();
    expect(edge.targetHandle).toBeUndefined();
  });

  it('bumps strokeWidth to 3 and pins opacity to 1 when selected (US-004)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'http' };
    const edge = connectorToEdge(c, false, true);
    expect(edge.style.strokeWidth).toBe(3);
    expect(edge.style.opacity).toBe(1);
  });

  it('preserves user-provided borderSize >= 3 when selected', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default', borderSize: 5 };
    const edge = connectorToEdge(c, false, true);
    expect(edge.style.strokeWidth).toBe(5);
  });

  it('keeps the connector kind dasharray when selected (event=dashed, queue=dotted)', () => {
    const eventC: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'event',
      eventName: 'x.y',
    };
    const queueC: Connector = {
      id: 'c2',
      source: 'a',
      target: 'b',
      kind: 'queue',
      queueName: 'q',
    };
    expect(connectorToEdge(eventC, false, true).style.strokeDasharray).toBe('6 4');
    expect(connectorToEdge(queueC, false, true).style.strokeDasharray).toBe('2 4');
  });

  it('does not bump strokeWidth or opacity when not selected', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'http' };
    const edge = connectorToEdge(c, false, false);
    expect(edge.style.strokeWidth).toBe(2);
    expect(edge.style.opacity).toBeUndefined();
  });

  it('forwards connector.path through edge.data so EditableEdge can branch geometry (US-017)', () => {
    const curveC: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const stepC: Connector = {
      id: 'c2',
      source: 'a',
      target: 'b',
      kind: 'default',
      path: 'step',
    };
    expect(connectorToEdge(curveC, false).data.path).toBeUndefined();
    expect(connectorToEdge(stepC, false).data.path).toBe('step');
  });

  it('paints the arrow marker in the same color as the connector stroke', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      color: 'blue',
      direction: 'both',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.style.stroke).toBeTruthy();
    expect(edge.markerStart?.color).toBe(edge.style.stroke);
    expect(edge.markerEnd?.color).toBe(edge.style.stroke);
  });

  it('renders the default token with an explicit stroke + matching marker (no fall-through to React Flow defaults)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const edge = connectorToEdge(c, false);
    expect(edge.style.stroke).toBeTruthy();
    expect(edge.markerEnd?.color).toBe(edge.style.stroke);
  });

  it('pins zIndex >= 1 so connectors paint above any node (US-007)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const idle = connectorToEdge(c, false, false);
    const running = connectorToEdge(c, true, false);
    const selected = connectorToEdge(c, false, true);
    expect(idle.zIndex).toBeGreaterThanOrEqual(1);
    expect(running.zIndex).toBe(idle.zIndex);
    expect(selected.zIndex).toBe(idle.zIndex);
  });
});
