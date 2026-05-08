import { describe, expect, it } from 'bun:test';
import type { DemoNode } from '@/lib/api';
import { nodeCenter, pickFacingHandle } from '@/lib/pick-facing-handle';

describe('pickFacingHandle', () => {
  // shapeNode has the same allowed-sides table as play/state on this codebase
  // (target = ['t','l'], source = ['r','b']) — pick it for the bulk of these
  // tests so the assertions stay focused on geometry, not kind dispatch.

  it('picks r when the other end is to the right (source role)', () => {
    expect(pickFacingHandle({ x: 0, y: 0 }, { x: 100, y: 0 }, 'source', 'shapeNode')).toBe('r');
  });

  it('picks l when the other end is to the left (target role)', () => {
    expect(pickFacingHandle({ x: 0, y: 0 }, { x: -100, y: 0 }, 'target', 'shapeNode')).toBe('l');
  });

  it('picks t when the other end is above (target role)', () => {
    expect(pickFacingHandle({ x: 0, y: 0 }, { x: 0, y: -100 }, 'target', 'shapeNode')).toBe('t');
  });

  it('picks b when the other end is below (source role)', () => {
    expect(pickFacingHandle({ x: 0, y: 0 }, { x: 0, y: 100 }, 'source', 'shapeNode')).toBe('b');
  });

  it('breaks 45° ties with dx >= 0 ? r : l (ideal-side rule)', () => {
    // Positive 45° (dx == dy > 0): ideal is 'r'. Source allows 'r' → 'r'.
    expect(pickFacingHandle({ x: 0, y: 0 }, { x: 50, y: 50 }, 'source', 'shapeNode')).toBe('r');
    // Negative 45° (dx == dy < 0): ideal is 'l'. Target allows 'l' → 'l'.
    expect(pickFacingHandle({ x: 0, y: 0 }, { x: -50, y: -50 }, 'target', 'shapeNode')).toBe('l');
  });

  it('source-side rejection: ideal l falls back to b/r via direction vector', () => {
    // Other end straight to the left → ideal 'l', not allowed for source.
    // Allowed source sides: ['r','b']. Dot products: r·(-1,0)=-1, b·(-1,0)=0.
    // 'b' wins (orthogonal beats antiparallel).
    expect(pickFacingHandle({ x: 0, y: 0 }, { x: -100, y: 0 }, 'source', 'shapeNode')).toBe('b');
  });

  it('source-side rejection: ideal t falls back to r when other end is straight up', () => {
    // Ideal 't', not allowed for source. Allowed: ['r','b']. With dy<0:
    // r·(0,-1)=0, b·(0,-1)=-1 → 'r'.
    expect(pickFacingHandle({ x: 0, y: 0 }, { x: 0, y: -100 }, 'source', 'shapeNode')).toBe('r');
  });

  it('target-side rejection: ideal r falls back to l/t via direction vector', () => {
    // Other end to the right → ideal 'r', not allowed for target.
    // Allowed: ['t','l']. With dx>0: t·(1,0)=0, l·(1,0)=-1 → 't'.
    expect(pickFacingHandle({ x: 0, y: 0 }, { x: 100, y: 0 }, 'target', 'shapeNode')).toBe('t');
  });

  it('honours the kind axis even though the layouts are currently uniform', () => {
    expect(pickFacingHandle({ x: 0, y: 0 }, { x: 100, y: 0 }, 'source', 'playNode')).toBe('r');
    expect(pickFacingHandle({ x: 0, y: 0 }, { x: -100, y: 0 }, 'target', 'stateNode')).toBe('l');
  });
});

describe('nodeCenter', () => {
  it('uses width/height from node.data when set', () => {
    const node: DemoNode = {
      id: 'n',
      type: 'shapeNode',
      position: { x: 100, y: 200 },
      data: { shape: 'rectangle', width: 80, height: 40 },
    };
    expect(nodeCenter(node)).toEqual({ x: 140, y: 220 });
  });

  it('falls back to a sensible default when width/height are unset', () => {
    const node: DemoNode = {
      id: 'n',
      type: 'shapeNode',
      position: { x: 100, y: 200 },
      data: { shape: 'rectangle' },
    };
    const c = nodeCenter(node);
    expect(c.x).toBeGreaterThan(100);
    expect(c.y).toBeGreaterThan(200);
  });
});
