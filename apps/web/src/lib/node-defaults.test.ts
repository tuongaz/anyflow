import { describe, expect, it } from 'bun:test';
import {
  NEW_NODE_BORDER_WIDTH,
  NEW_NODE_FONT_SIZE,
  buildNewGroupData,
  buildNewImageData,
  buildNewShapeData,
} from './node-defaults';

describe('buildNewShapeData', () => {
  it('rectangle gets borderSize=1 and fontSize=12', () => {
    const data = buildNewShapeData('rectangle', { width: 200, height: 120 });
    expect(data.shape).toBe('rectangle');
    expect(data.width).toBe(200);
    expect(data.height).toBe(120);
    expect(data.borderSize).toBe(NEW_NODE_BORDER_WIDTH);
    expect(data.fontSize).toBe(NEW_NODE_FONT_SIZE);
  });

  it('ellipse gets borderSize=1 and fontSize=12', () => {
    const data = buildNewShapeData('ellipse', { width: 160, height: 100 });
    expect(data.borderSize).toBe(1);
    expect(data.fontSize).toBe(12);
  });

  it('sticky gets borderSize=1 and fontSize=12', () => {
    const data = buildNewShapeData('sticky', { width: 180, height: 180 });
    expect(data.borderSize).toBe(1);
    expect(data.fontSize).toBe(12);
  });

  it('text variant gets fontSize=12 but NO borderSize (text stays chromeless)', () => {
    const data = buildNewShapeData('text', { width: 120, height: 36 });
    expect(data.shape).toBe('text');
    expect(data.fontSize).toBe(NEW_NODE_FONT_SIZE);
    expect(data.borderSize).toBeUndefined();
    expect('borderSize' in data).toBe(false);
  });

  it('preserves the requested dims regardless of variant', () => {
    const a = buildNewShapeData('rectangle', { width: 5, height: 7 });
    const b = buildNewShapeData('text', { width: 11, height: 13 });
    expect(a.width).toBe(5);
    expect(a.height).toBe(7);
    expect(b.width).toBe(11);
    expect(b.height).toBe(13);
  });
});

describe('buildNewImageData', () => {
  it('image gets borderWidth=1 (NOT borderSize) and no fontSize', () => {
    const data = buildNewImageData('assets/hello.png', { width: 200, height: 150 });
    expect(data.path).toBe('assets/hello.png');
    expect(data.width).toBe(200);
    expect(data.height).toBe(150);
    expect(data.borderWidth).toBe(NEW_NODE_BORDER_WIDTH);
    // image renders no body text — fontSize is intentionally absent.
    expect('fontSize' in data).toBe(false);
    // confirm we used the group/image naming, not the shape spelling.
    expect('borderSize' in data).toBe(false);
    // US-004: on-disk field is `path`, not `image` (base64 hard-cut).
    expect('image' in data).toBe(false);
  });
});

describe('buildNewGroupData', () => {
  it('group gets borderWidth=1 (NOT borderSize) and no fontSize', () => {
    const data = buildNewGroupData({ width: 320, height: 240 });
    expect(data.width).toBe(320);
    expect(data.height).toBe(240);
    expect(data.borderWidth).toBe(NEW_NODE_BORDER_WIDTH);
    // groups render no body text — fontSize is intentionally absent.
    expect('fontSize' in data).toBe(false);
    expect('borderSize' in data).toBe(false);
  });

  it('preserves requested dims', () => {
    const data = buildNewGroupData({ width: 999, height: 1 });
    expect(data.width).toBe(999);
    expect(data.height).toBe(1);
  });
});

describe('constants', () => {
  it('NEW_NODE_BORDER_WIDTH = 1 (wireframe-style thin border)', () => {
    expect(NEW_NODE_BORDER_WIDTH).toBe(1);
  });

  it('NEW_NODE_FONT_SIZE = 12 (compact label size)', () => {
    expect(NEW_NODE_FONT_SIZE).toBe(12);
  });
});
