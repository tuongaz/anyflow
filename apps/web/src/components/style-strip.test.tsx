import { describe, expect, it, mock } from 'bun:test';
import { type NodeStylePatch, StyleStrip, type StyleStripProps } from '@/components/style-strip';
import type { Connector, DemoNode } from '@/lib/api';
import * as React from 'react';

// Same dispatcher-shim trick used by icon-node.test.tsx and
// icon-picker-popover.test.tsx — apps/web tests run without a DOM, so we
// can't mount the real Radix Popover/Tooltip tree. Calling StyleStrip as a
// function under the shim returns the first render with sub-components
// (SwatchButton, PopoverButton, etc.) captured as `{ type, props }`
// placeholders. We walk that tree to find the iconNode color SwatchButton
// and invoke its `onSelect` to assert the apply wiring.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

function renderWithHooks<T>(fn: () => T): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const value = typeof initial === 'function' ? (initial as () => S)() : initial;
      return [value, () => {}];
    },
    useCallback: <T,>(fn: T) => fn,
    useMemo: <T,>(fn: () => T) => fn(),
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: () => {},
  };
  try {
    return fn();
  } finally {
    internals.ReactCurrentDispatcher.current = prev;
  }
}

type ReactElementLike = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function isElement(value: unknown): value is ReactElementLike {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'props' in (value as { props?: unknown })
  );
}

function findElement(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
): ReactElementLike | null {
  if (!isElement(tree)) return null;
  if (predicate(tree)) return tree;
  const children = tree.props.children;
  if (children === undefined || children === null) return null;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function findAll(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
  acc: ReactElementLike[] = [],
): ReactElementLike[] {
  if (!isElement(tree)) return acc;
  if (predicate(tree)) acc.push(tree);
  const children = tree.props.children;
  if (children === undefined || children === null) return acc;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) findAll(child, predicate, acc);
  return acc;
}

// The strip's SwatchButton / PopoverButton sub-components receive the test id
// via a `testId` prop (which they then render as `data-testid` on the inner
// <button>). Under the dispatcher shim sub-component bodies don't execute, so
// the wrapping element only carries the `testId` prop — match that, not
// `data-testid`. Fall back to `data-testid` for any plain DOM nodes the strip
// renders directly (e.g. the outer canvas-style-strip wrapper).
function testIdEquals(id: string) {
  return (el: ReactElementLike) => {
    const p = el.props as { testId?: string; 'data-testid'?: string };
    return p.testId === id || p['data-testid'] === id;
  };
}

function callStrip(overrides: Partial<StyleStripProps> = {}): unknown {
  const props: StyleStripProps = {
    nodes: [],
    connectors: [],
    onStyleNode: () => {},
    onStyleConnector: () => {},
    ...overrides,
  };
  return renderWithHooks(() => (StyleStrip as unknown as (p: StyleStripProps) => unknown)(props));
}

function iconNode(id: string, color?: string): DemoNode {
  return {
    id,
    type: 'iconNode',
    position: { x: 0, y: 0 },
    data: { icon: 'shopping-cart', ...(color ? { color } : {}) },
  } as DemoNode;
}

function shapeNode(id: string): DemoNode {
  return {
    id,
    type: 'shapeNode',
    position: { x: 0, y: 0 },
    data: { shape: 'rectangle', label: 's' },
  } as DemoNode;
}

describe('StyleStrip — iconNode color picker (US-014)', () => {
  it('renders only the icon-color swatch when an iconNode is selected', () => {
    const tree = callStrip({ nodes: [iconNode('n1', 'blue')] });
    const iconSwatch = findElement(tree, testIdEquals('style-strip-icon-color'));
    expect(iconSwatch).not.toBeNull();
    expect((iconSwatch?.props as { activeToken?: string }).activeToken).toBe('blue');
    expect((iconSwatch?.props as { previewKind?: string }).previewKind).toBe('edge');

    // None of the shared / shape controls should appear in the iconNode-only
    // strip — no fill, no border style/size, no font size, no corner radius.
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-fill'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-style'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-font-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-corner-radius'))).toBeNull();
  });

  it('clicking a swatch token dispatches onStyleNode with { color }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [iconNode('n1')], onStyleNode });
    const iconSwatch = findElement(tree, testIdEquals('style-strip-icon-color'));
    if (!iconSwatch) throw new Error('icon-color swatch missing');
    const onSelect = (iconSwatch.props as { onSelect: (token: string) => void }).onSelect;
    onSelect('green');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('n1', { color: 'green' });
  });

  it('fans out the picked color to every selected iconNode', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [iconNode('n1', 'blue'), iconNode('n2')],
      onStyleNode,
    });
    const iconSwatch = findElement(tree, testIdEquals('style-strip-icon-color'));
    if (!iconSwatch) throw new Error('icon-color swatch missing');
    const onSelect = (iconSwatch.props as { onSelect: (token: string) => void }).onSelect;
    onSelect('red');
    expect(onStyleNode).toHaveBeenCalledTimes(2);
    expect(onStyleNode).toHaveBeenNthCalledWith(1, 'n1', { color: 'red' });
    expect(onStyleNode).toHaveBeenNthCalledWith(2, 'n2', { color: 'red' });
  });

  it("active token falls back to 'default' when data.color is unset", () => {
    const tree = callStrip({ nodes: [iconNode('n1')] });
    const iconSwatch = findElement(tree, testIdEquals('style-strip-icon-color'));
    expect((iconSwatch?.props as { activeToken?: string }).activeToken).toBe('default');
  });

  it('does NOT render the icon-color swatch when no node is selected', () => {
    const tree = callStrip({ nodes: [], connectors: [] });
    // Empty selection → strip returns null. Tree is null/false, so any
    // findElement returns null.
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).toBeNull();
  });

  it('does NOT render the icon-color swatch when a non-iconNode is selected', () => {
    const tree = callStrip({ nodes: [shapeNode('s1')] });
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).toBeNull();
    // The existing shape strip should still be present.
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).not.toBeNull();
  });

  it('does NOT render the icon-color swatch in a mixed (iconNode + shape) selection', () => {
    const tree = callStrip({ nodes: [iconNode('n1', 'blue'), shapeNode('s1')] });
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).toBeNull();
    // Shared controls drive the non-icon nodes; border-color swatch is visible.
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).not.toBeNull();
  });

  it('the patch shape uses `color` (not borderColor/backgroundColor) — type-level check', () => {
    // Compile-time guard: the iconNode patch must be a NodeStylePatch with a
    // `color` field. If the field is removed from the interface this test
    // fails to compile.
    const patch: NodeStylePatch = { color: 'amber' };
    expect(patch.color).toBe('amber');
  });

  it('handles multiple sibling iconNodes without leaking other controls', () => {
    const tree = callStrip({ nodes: [iconNode('a'), iconNode('b'), iconNode('c')] });
    const swatches = findAll(tree, testIdEquals('style-strip-icon-color'));
    expect(swatches.length).toBe(1);
  });

  it('hides the icon-color swatch when iconNode + connector are selected together', () => {
    // pureIconNode requires no connectors; the shared/connector strip takes
    // over for mixed selections so the icon-only branch stays narrow.
    const cn: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
    } as Connector;
    const tree = callStrip({ nodes: [iconNode('n1')], connectors: [cn] });
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).toBeNull();
  });
});

describe('StyleStrip — iconNode Change-icon button (US-022)', () => {
  it('renders the Change-icon button when a single iconNode is selected and the callback is wired', () => {
    const tree = callStrip({
      nodes: [iconNode('n1')],
      onRequestIconReplace: () => {},
    });
    const btn = findElement(tree, testIdEquals('style-strip-change-icon'));
    expect(btn).not.toBeNull();
  });

  it('clicking the Change-icon button calls onRequestIconReplace with the node id', () => {
    const onRequestIconReplace = mock((_id: string) => {});
    const tree = callStrip({
      nodes: [iconNode('n-42')],
      onRequestIconReplace,
    });
    const btn = findElement(tree, testIdEquals('style-strip-change-icon'));
    if (!btn) throw new Error('change-icon button missing');
    const onClick = btn.props.onClick as () => void;
    onClick();
    expect(onRequestIconReplace).toHaveBeenCalledTimes(1);
    expect(onRequestIconReplace).toHaveBeenCalledWith('n-42');
  });

  it('hides the Change-icon button when onRequestIconReplace is undefined', () => {
    const tree = callStrip({ nodes: [iconNode('n1')] });
    expect(findElement(tree, testIdEquals('style-strip-change-icon'))).toBeNull();
    // The color swatch is still present — only the change button hides.
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).not.toBeNull();
  });

  it('hides the Change-icon button on a multi-iconNode selection (ambiguous target)', () => {
    const tree = callStrip({
      nodes: [iconNode('a'), iconNode('b')],
      onRequestIconReplace: () => {},
    });
    expect(findElement(tree, testIdEquals('style-strip-change-icon'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).not.toBeNull();
  });

  it('hides the Change-icon button on a non-iconNode selection', () => {
    const tree = callStrip({
      nodes: [shapeNode('s1')],
      onRequestIconReplace: () => {},
    });
    expect(findElement(tree, testIdEquals('style-strip-change-icon'))).toBeNull();
  });
});
