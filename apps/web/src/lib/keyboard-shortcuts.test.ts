import { describe, expect, it } from 'bun:test';
import { applyNudge, getNudgeDelta, getZoomChord } from '@/lib/keyboard-shortcuts';

const ev = (
  overrides: Partial<{
    key: string;
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
  }> = {},
) => ({
  key: '',
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...overrides,
});

describe('getNudgeDelta', () => {
  it('returns 1px on bare arrow keys', () => {
    expect(getNudgeDelta(ev({ key: 'ArrowRight' }))).toEqual({ dx: 1, dy: 0 });
    expect(getNudgeDelta(ev({ key: 'ArrowLeft' }))).toEqual({ dx: -1, dy: 0 });
    expect(getNudgeDelta(ev({ key: 'ArrowDown' }))).toEqual({ dx: 0, dy: 1 });
    expect(getNudgeDelta(ev({ key: 'ArrowUp' }))).toEqual({ dx: 0, dy: -1 });
  });

  it('returns 10px when Shift is held', () => {
    expect(getNudgeDelta(ev({ key: 'ArrowRight', shiftKey: true }))).toEqual({ dx: 10, dy: 0 });
    expect(getNudgeDelta(ev({ key: 'ArrowLeft', shiftKey: true }))).toEqual({ dx: -10, dy: 0 });
    expect(getNudgeDelta(ev({ key: 'ArrowDown', shiftKey: true }))).toEqual({ dx: 0, dy: 10 });
    expect(getNudgeDelta(ev({ key: 'ArrowUp', shiftKey: true }))).toEqual({ dx: 0, dy: -10 });
  });

  it('returns null when Cmd/Ctrl/Alt are held', () => {
    expect(getNudgeDelta(ev({ key: 'ArrowRight', metaKey: true }))).toBeNull();
    expect(getNudgeDelta(ev({ key: 'ArrowLeft', ctrlKey: true }))).toBeNull();
    expect(getNudgeDelta(ev({ key: 'ArrowUp', altKey: true }))).toBeNull();
  });

  it('returns null for non-arrow keys', () => {
    expect(getNudgeDelta(ev({ key: 'a' }))).toBeNull();
    expect(getNudgeDelta(ev({ key: 'Enter' }))).toBeNull();
    expect(getNudgeDelta(ev({ key: ' ' }))).toBeNull();
  });
});

describe('getZoomChord', () => {
  it('Cmd/Ctrl+0 → fit', () => {
    expect(getZoomChord(ev({ key: '0', metaKey: true }))).toBe('fit');
    expect(getZoomChord(ev({ key: '0', ctrlKey: true }))).toBe('fit');
  });

  it('Cmd+= and Cmd+Shift+= (Plus) → in', () => {
    expect(getZoomChord(ev({ key: '=', metaKey: true }))).toBe('in');
    expect(getZoomChord(ev({ key: '+', metaKey: true, shiftKey: true }))).toBe('in');
    expect(getZoomChord(ev({ key: '=', ctrlKey: true }))).toBe('in');
  });

  it('Cmd+- → out', () => {
    expect(getZoomChord(ev({ key: '-', metaKey: true }))).toBe('out');
    expect(getZoomChord(ev({ key: '-', ctrlKey: true }))).toBe('out');
    expect(getZoomChord(ev({ key: '_', metaKey: true, shiftKey: true }))).toBe('out');
  });

  it('returns null without Cmd/Ctrl', () => {
    expect(getZoomChord(ev({ key: '0' }))).toBeNull();
    expect(getZoomChord(ev({ key: '=', shiftKey: true }))).toBeNull();
  });

  it('returns null when Alt is held', () => {
    expect(getZoomChord(ev({ key: '0', metaKey: true, altKey: true }))).toBeNull();
  });

  it('returns null for unrelated keys (e.g. Cmd+L, Cmd+Shift+L)', () => {
    expect(getZoomChord(ev({ key: 'l', metaKey: true }))).toBeNull();
    expect(getZoomChord(ev({ key: 'L', metaKey: true, shiftKey: true }))).toBeNull();
    expect(getZoomChord(ev({ key: 'a', metaKey: true }))).toBeNull();
  });
});

describe('applyNudge', () => {
  const nodes = [
    { id: 'a', position: { x: 100, y: 100 } },
    { id: 'b', position: { x: 200, y: 50 } },
    { id: 'c', position: { x: 0, y: 0 } },
  ];

  it('shifts a single selected node by the delta', () => {
    expect(applyNudge({ dx: 1, dy: 0 }, ['a'], nodes)).toEqual([
      { id: 'a', position: { x: 101, y: 100 } },
    ]);
  });

  it('uses 10px on every selected id under Shift+arrow', () => {
    expect(applyNudge({ dx: 0, dy: 10 }, ['a', 'b'], nodes)).toEqual([
      { id: 'a', position: { x: 100, y: 110 } },
      { id: 'b', position: { x: 200, y: 60 } },
    ]);
  });

  it('moves every selected id by the same delta in one keystroke', () => {
    const result = applyNudge({ dx: -1, dy: 0 }, ['a', 'b', 'c'], nodes);
    expect(result.length).toBe(3);
    expect(result.find((u) => u.id === 'a')?.position).toEqual({ x: 99, y: 100 });
    expect(result.find((u) => u.id === 'b')?.position).toEqual({ x: 199, y: 50 });
    expect(result.find((u) => u.id === 'c')?.position).toEqual({ x: -1, y: 0 });
  });

  it('skips ids that are not present (pure-connector selection → no-op)', () => {
    expect(applyNudge({ dx: 1, dy: 0 }, ['conn-1', 'conn-2'], nodes)).toEqual([]);
  });

  it('returns [] when the selection is empty', () => {
    expect(applyNudge({ dx: 1, dy: 0 }, [], nodes)).toEqual([]);
  });
});
