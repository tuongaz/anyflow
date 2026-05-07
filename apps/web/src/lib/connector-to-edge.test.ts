import { describe, expect, it } from 'bun:test';
import type { Connector } from '@/lib/api';
import { connectorToEdge, styleForKind } from '@/lib/connector-to-edge';
import { MarkerType } from '@xyflow/react';

describe('connectorToEdge', () => {
  it('preserves id/source/target and uses smoothstep edge type', () => {
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
    expect(edge.type).toBe('smoothstep');
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
    expect(connectorToEdge(c, false).style).toEqual({});
  });

  it('lets per-connector style override the kind-derived style', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'http',
      style: 'dashed',
    };
    expect(connectorToEdge(c, false).style).toEqual({ strokeDasharray: '6 4' });
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
});
