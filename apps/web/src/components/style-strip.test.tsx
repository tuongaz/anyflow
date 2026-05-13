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

// US-008 helper. `active` mirrors the transient `data.isActive` flag injected
// by demo-canvas when the user has double-clicked into the group. Style fields
// default to undefined so each test can dial in a partial chrome state.
function groupNode(
  id: string,
  opts: {
    active?: boolean;
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
    borderStyle?: 'solid' | 'dashed' | 'dotted';
  } = {},
): DemoNode {
  return {
    id,
    type: 'group',
    position: { x: 0, y: 0 },
    data: {
      ...(opts.active ? { isActive: true } : {}),
      ...(opts.backgroundColor ? { backgroundColor: opts.backgroundColor } : {}),
      ...(opts.borderColor ? { borderColor: opts.borderColor } : {}),
      ...(opts.borderWidth !== undefined ? { borderWidth: opts.borderWidth } : {}),
      ...(opts.borderStyle ? { borderStyle: opts.borderStyle } : {}),
    },
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

describe('StyleStrip — group chrome editor (US-008 + US-012)', () => {
  it('renders the group chrome controls when an isActive group is selected', () => {
    const tree = callStrip({ nodes: [groupNode('g1', { active: true })] });
    // The four chrome controls are the only buttons the group strip needs;
    // every other test id (shape-only controls) must be absent.
    expect(findElement(tree, testIdEquals('style-strip-group-border-color'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-group-fill'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-group-border-style'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-group-border-width'))).not.toBeNull();
    // Shape-only controls must NOT leak into the group branch.
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-fill'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-style'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-font-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-corner-radius'))).toBeNull();
  });

  it('US-012: also renders the group chrome controls when isActive is absent', () => {
    // US-012 loosened the US-008 gate so a single-click (selected-but-not-
    // entered) group also gets the chrome editor. Same four controls, same
    // dispatch wiring as the entered state.
    const tree = callStrip({ nodes: [groupNode('g1')] });
    expect(findElement(tree, testIdEquals('style-strip-group-border-color'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-group-fill'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-group-border-style'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-group-border-width'))).not.toBeNull();
    // Shape-only controls stay hidden — group branch takes over.
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-size'))).toBeNull();
  });

  it("US-012: data-group-active is 'false' for a selected-but-not-entered group", () => {
    // Wrapper carries the entered state as an informational data attribute so
    // playwright snapshots / future visual hints can branch on it without
    // forking the editor markup. Inactive group → "false"; active → "true".
    const tree = callStrip({ nodes: [groupNode('g1')] });
    const strip = findElement(tree, testIdEquals('canvas-style-strip'));
    expect(strip).not.toBeNull();
    expect((strip?.props as { 'data-group-active'?: string })['data-group-active']).toBe('false');
  });

  it("US-012: data-group-active is 'true' for an entered group (regression pin)", () => {
    const tree = callStrip({ nodes: [groupNode('g1', { active: true })] });
    const strip = findElement(tree, testIdEquals('canvas-style-strip'));
    expect(strip).not.toBeNull();
    expect((strip?.props as { 'data-group-active'?: string })['data-group-active']).toBe('true');
  });

  it('US-012: inactive-group edits dispatch onStyleNode with the same patch shape as active', () => {
    // The point of US-012 is behavioural parity: edits in the inactive state
    // should be indistinguishable from the active state at the callback layer
    // so they go through the same PATCH path + share the same coalesce key.
    const onStyleNodeInactive = mock(() => {});
    const onStyleNodeActive = mock(() => {});

    const inactiveTree = callStrip({
      nodes: [groupNode('g1')],
      onStyleNode: onStyleNodeInactive,
    });
    const inactiveSwatch = findElement(
      inactiveTree,
      testIdEquals('style-strip-group-border-color'),
    );
    if (!inactiveSwatch) throw new Error('inactive group border-color swatch missing');
    (inactiveSwatch.props as { onSelect: (token: string) => void }).onSelect('blue');

    const activeTree = callStrip({
      nodes: [groupNode('g1', { active: true })],
      onStyleNode: onStyleNodeActive,
    });
    const activeSwatch = findElement(activeTree, testIdEquals('style-strip-group-border-color'));
    if (!activeSwatch) throw new Error('active group border-color swatch missing');
    (activeSwatch.props as { onSelect: (token: string) => void }).onSelect('blue');

    expect(onStyleNodeInactive).toHaveBeenCalledTimes(1);
    expect(onStyleNodeActive).toHaveBeenCalledTimes(1);
    expect(onStyleNodeInactive.mock.calls[0]).toEqual(onStyleNodeActive.mock.calls[0]);
  });

  it('does NOT render the group chrome branch when the group is mixed with another node', () => {
    // Pure single-node guard: a group + a sibling shape falls through to the
    // shared shape strip (the shape's borderColor swatch is what the user
    // expects to drive). The active-group editor is single-target only.
    const tree = callStrip({
      nodes: [groupNode('g1', { active: true }), shapeNode('s1')],
    });
    expect(findElement(tree, testIdEquals('style-strip-group-border-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).not.toBeNull();
  });

  it('does NOT render the group chrome branch when a connector is also selected', () => {
    // pureNode gate: any connector in the selection routes to the shared
    // shape+connector strip, so the group editor stays hidden.
    const cn: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
    } as Connector;
    const tree = callStrip({
      nodes: [groupNode('g1', { active: true })],
      connectors: [cn],
    });
    expect(findElement(tree, testIdEquals('style-strip-group-border-color'))).toBeNull();
  });

  it('seeds the active tokens from the group data fields', () => {
    const tree = callStrip({
      nodes: [
        groupNode('g1', {
          active: true,
          backgroundColor: 'blue',
          borderColor: 'amber',
          borderStyle: 'dotted',
          borderWidth: 5,
        }),
      ],
    });
    const borderColor = findElement(tree, testIdEquals('style-strip-group-border-color'));
    const fill = findElement(tree, testIdEquals('style-strip-group-fill'));
    expect((borderColor?.props as { activeToken?: string }).activeToken).toBe('amber');
    expect((fill?.props as { activeToken?: string }).activeToken).toBe('blue');
  });

  it("falls back to 'default' tokens when chrome fields are unset", () => {
    const tree = callStrip({ nodes: [groupNode('g1', { active: true })] });
    const borderColor = findElement(tree, testIdEquals('style-strip-group-border-color'));
    const fill = findElement(tree, testIdEquals('style-strip-group-fill'));
    expect((borderColor?.props as { activeToken?: string }).activeToken).toBe('default');
    expect((fill?.props as { activeToken?: string }).activeToken).toBe('default');
  });

  it('clicking the border-color swatch dispatches onStyleNode with { borderColor }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [groupNode('g1', { active: true })],
      onStyleNode,
    });
    const swatch = findElement(tree, testIdEquals('style-strip-group-border-color'));
    if (!swatch) throw new Error('group border-color swatch missing');
    const onSelect = (swatch.props as { onSelect: (token: string) => void }).onSelect;
    onSelect('blue');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('g1', { borderColor: 'blue' });
  });

  it('clicking the fill swatch dispatches onStyleNode with { backgroundColor }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [groupNode('g1', { active: true })],
      onStyleNode,
    });
    const swatch = findElement(tree, testIdEquals('style-strip-group-fill'));
    if (!swatch) throw new Error('group fill swatch missing');
    const onSelect = (swatch.props as { onSelect: (token: string) => void }).onSelect;
    onSelect('amber');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('g1', { backgroundColor: 'amber' });
  });

  it('the border-width slider commits + previews to onStyleNode/onStyleNodePreview', () => {
    const onStyleNode = mock(() => {});
    const onStyleNodePreview = mock(() => {});
    const tree = callStrip({
      nodes: [groupNode('g1', { active: true })],
      onStyleNode,
      onStyleNodePreview,
    });
    const popover = findElement(tree, testIdEquals('style-strip-group-border-width'));
    if (!popover) throw new Error('group border-width popover missing');
    // The popover contains a SliderControl element whose onCommit/onPreview
    // are pre-bound to applyGroupBorderWidth + previewGroupBorderWidth. Walk
    // into the popover's children to find the SliderControl props.
    const slider = findElement(popover, (el) => {
      const p = el.props as { testId?: string };
      return p.testId === 'style-tab-group-border-width-slider';
    });
    if (!slider) throw new Error('border-width slider missing');
    const sliderProps = slider.props as {
      onCommit: (n: number) => void;
      onPreview?: (n: number) => void;
      min: number;
      max: number;
    };
    expect(sliderProps.min).toBe(1);
    expect(sliderProps.max).toBe(8);
    sliderProps.onPreview?.(3);
    sliderProps.onCommit(6);
    expect(onStyleNodePreview).toHaveBeenCalledTimes(1);
    expect(onStyleNodePreview).toHaveBeenCalledWith('g1', { borderWidth: 3 });
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('g1', { borderWidth: 6 });
  });

  it('the border-style toggle dispatches onStyleNode with { borderStyle }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [groupNode('g1', { active: true })],
      onStyleNode,
    });
    const popover = findElement(tree, testIdEquals('style-strip-group-border-style'));
    if (!popover) throw new Error('group border-style popover missing');
    // Locate the inner IconToggleGroup (its props carry `onChange` + `value`).
    const toggle = findElement(popover, (el) => {
      const p = el.props as { ariaLabel?: string };
      return p.ariaLabel === 'Border style';
    });
    if (!toggle) throw new Error('border-style toggle missing');
    const onChange = (toggle.props as { onChange: (s: 'solid' | 'dashed' | 'dotted') => void })
      .onChange;
    onChange('solid');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('g1', { borderStyle: 'solid' });
  });

  it('the patch shape uses `borderWidth` (NOT borderSize) — type-level check', () => {
    // Compile-time guard: removing `borderWidth` from NodeStylePatch breaks
    // this test. The shape-node strip writes `borderSize`; the group strip
    // writes `borderWidth` to land in the GroupNodeData schema field.
    const patch: NodeStylePatch = { borderWidth: 4 };
    expect(patch.borderWidth).toBe(4);
  });
});

// US-014: image-node border editor. Mirrors the group chrome editor (border
// color picker, border style toggle, border width 1–8) but writes through
// onStyleNode for any selected imageNode. Multi-image fan-out follows the
// pureIconNode pattern; mixed selections (image + shape) fall through to the
// shared shape strip.
// US-004: image nodes reference a relative `path` (resolved at render time
// against the project file endpoint) instead of an inline base64 data URL.
const SAMPLE_PATH = 'assets/pixel.png';

function imageNode(
  id: string,
  opts: {
    borderColor?: string;
    borderWidth?: number;
    borderStyle?: 'solid' | 'dashed' | 'dotted';
    cornerRadius?: number;
  } = {},
): DemoNode {
  return {
    id,
    type: 'imageNode',
    position: { x: 0, y: 0 },
    data: {
      path: SAMPLE_PATH,
      ...(opts.borderColor ? { borderColor: opts.borderColor } : {}),
      ...(opts.borderWidth !== undefined ? { borderWidth: opts.borderWidth } : {}),
      ...(opts.borderStyle ? { borderStyle: opts.borderStyle } : {}),
      ...(opts.cornerRadius !== undefined ? { cornerRadius: opts.cornerRadius } : {}),
    },
  } as DemoNode;
}

describe('StyleStrip — image-node border editor (US-014)', () => {
  it('renders the image border controls when a single imageNode is selected', () => {
    const tree = callStrip({ nodes: [imageNode('i1', { borderColor: 'blue', borderWidth: 3 })] });
    expect(findElement(tree, testIdEquals('style-strip-image-border-color'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-image-border-style'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-image-border-width'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-image-corner-radius'))).not.toBeNull();
    // Shape-only controls must NOT leak into the image branch.
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-font-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-fill'))).toBeNull();
    // Group-only controls must not leak either.
    expect(findElement(tree, testIdEquals('style-strip-group-border-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-group-border-width'))).toBeNull();
    // Icon-only controls must not leak either.
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).toBeNull();
  });

  it('seeds the active border-color token from data.borderColor', () => {
    const tree = callStrip({ nodes: [imageNode('i1', { borderColor: 'amber' })] });
    const swatch = findElement(tree, testIdEquals('style-strip-image-border-color'));
    expect((swatch?.props as { activeToken?: string }).activeToken).toBe('amber');
  });

  it("falls back to 'default' border-color when data.borderColor is unset", () => {
    const tree = callStrip({ nodes: [imageNode('i1')] });
    const swatch = findElement(tree, testIdEquals('style-strip-image-border-color'));
    expect((swatch?.props as { activeToken?: string }).activeToken).toBe('default');
  });

  it('clicking a border-color swatch dispatches onStyleNode with { borderColor }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [imageNode('i1')], onStyleNode });
    const swatch = findElement(tree, testIdEquals('style-strip-image-border-color'));
    if (!swatch) throw new Error('image border-color swatch missing');
    (swatch.props as { onSelect: (t: string) => void }).onSelect('green');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('i1', { borderColor: 'green' });
  });

  it('fans out the border-color pick to every selected imageNode (multi-select)', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [imageNode('i1'), imageNode('i2', { borderColor: 'red' })],
      onStyleNode,
    });
    const swatch = findElement(tree, testIdEquals('style-strip-image-border-color'));
    if (!swatch) throw new Error('image border-color swatch missing');
    (swatch.props as { onSelect: (t: string) => void }).onSelect('purple');
    expect(onStyleNode).toHaveBeenCalledTimes(2);
    expect(onStyleNode).toHaveBeenNthCalledWith(1, 'i1', { borderColor: 'purple' });
    expect(onStyleNode).toHaveBeenNthCalledWith(2, 'i2', { borderColor: 'purple' });
  });

  it('the border-style toggle dispatches onStyleNode with { borderStyle }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [imageNode('i1', { borderStyle: 'solid' })],
      onStyleNode,
    });
    const popover = findElement(tree, testIdEquals('style-strip-image-border-style'));
    if (!popover) throw new Error('image border-style popover missing');
    const toggle = findElement(popover, (el) => {
      const p = el.props as { ariaLabel?: string };
      return p.ariaLabel === 'Border style';
    });
    if (!toggle) throw new Error('image border-style toggle missing');
    (toggle.props as { onChange: (s: 'solid' | 'dashed' | 'dotted') => void }).onChange('dashed');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('i1', { borderStyle: 'dashed' });
  });

  it('the border-width slider commits + previews onStyleNode/onStyleNodePreview with 1–8 range', () => {
    const onStyleNode = mock(() => {});
    const onStyleNodePreview = mock(() => {});
    const tree = callStrip({
      nodes: [imageNode('i1', { borderWidth: 2 })],
      onStyleNode,
      onStyleNodePreview,
    });
    const popover = findElement(tree, testIdEquals('style-strip-image-border-width'));
    if (!popover) throw new Error('image border-width popover missing');
    const slider = findElement(popover, (el) => {
      const p = el.props as { testId?: string };
      return p.testId === 'style-tab-image-border-width-slider';
    });
    if (!slider) throw new Error('image border-width slider missing');
    const props = slider.props as {
      onCommit: (n: number) => void;
      onPreview?: (n: number) => void;
      min: number;
      max: number;
    };
    expect(props.min).toBe(1);
    expect(props.max).toBe(8);
    props.onPreview?.(4);
    props.onCommit(6);
    expect(onStyleNodePreview).toHaveBeenCalledTimes(1);
    expect(onStyleNodePreview).toHaveBeenCalledWith('i1', { borderWidth: 4 });
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('i1', { borderWidth: 6 });
  });

  it('does NOT render the image branch in a mixed (image + shape) selection', () => {
    const tree = callStrip({ nodes: [imageNode('i1'), shapeNode('s1')] });
    expect(findElement(tree, testIdEquals('style-strip-image-border-color'))).toBeNull();
    // Mixed selection falls through to the shared shape strip.
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).not.toBeNull();
  });

  it('does NOT render the image branch when a connector is also selected', () => {
    const cn: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
    } as Connector;
    const tree = callStrip({ nodes: [imageNode('i1')], connectors: [cn] });
    expect(findElement(tree, testIdEquals('style-strip-image-border-color'))).toBeNull();
  });
});
