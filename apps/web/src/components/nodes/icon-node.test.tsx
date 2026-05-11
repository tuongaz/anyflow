import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { ICON_FALLBACK_NAME, IconNode } from '@/components/nodes/icon-node';
import { ResizeControls } from '@/components/nodes/resize-controls';
import { ICON_REGISTRY } from '@/lib/icon-registry';
import type { NodeProps } from '@xyflow/react';
import * as React from 'react';

// Bun runs apps/web tests without a DOM, and React Flow's `<Handle>` reads
// from a zustand provider that only exists inside a real ReactFlow mount —
// so `renderToStaticMarkup(<IconNode />)` blows up before reaching the
// glyph. Instead we shim React's internal dispatcher and call IconNode as
// a function: every hook IconNode uses (useState today) returns a synchronous
// initial value, the returned React element tree is the first render, and
// we walk it to find the elements under test. Handle/ResizeControls etc. are
// captured as `{ type, props }` placeholders without executing their render
// bodies, so their zustand dependencies never trip.
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
  predicate: (type: unknown) => boolean,
): ReactElementLike | null {
  if (!isElement(tree)) return null;
  if (predicate(tree.type)) return tree;
  const children = tree.props.children;
  if (children === undefined || children === null) return null;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function callIconNode(data: Record<string, unknown>, overrides: Partial<NodeProps> = {}): unknown {
  const props = {
    id: 'n1',
    type: 'iconNode',
    data,
    selected: false,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
    dragging: false,
    deletable: true,
    draggable: true,
    selectable: true,
    ...overrides,
  } as unknown as NodeProps;
  return renderWithHooks(() => (IconNode as unknown as (p: NodeProps) => unknown)(props));
}

describe('IconNode', () => {
  beforeEach(() => {
    mock.restore();
  });

  it('renders the correct Lucide component for a known name', () => {
    const tree = callIconNode({ icon: 'shopping-cart' });
    const lucide = findElement(tree, (type) => type === ICON_REGISTRY['shopping-cart']);
    expect(lucide).not.toBeNull();
  });

  it('falls back to help-circle on an unknown name and warns once', () => {
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy as unknown as typeof console.warn;
    try {
      const tree = callIconNode({ icon: 'definitely-not-a-real-icon' });
      // The fallback component is identity-equal to ICON_REGISTRY['help-circle'].
      const fallback = ICON_REGISTRY[ICON_FALLBACK_NAME];
      expect(fallback).toBeDefined();
      const lucide = findElement(tree, (type) => type === fallback);
      expect(lucide).not.toBeNull();
      // The original (unknown) icon name must NOT be in the registry.
      expect(ICON_REGISTRY['definitely-not-a-real-icon']).toBeUndefined();
      // Warn-once: a second render with the same unknown name must not warn again.
      callIconNode({ icon: 'definitely-not-a-real-icon' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('data.color overrides default (currentColor)', () => {
    const lucideType = ICON_REGISTRY['shopping-cart'];

    const defaultTree = callIconNode({ icon: 'shopping-cart' });
    const defaultLucide = findElement(defaultTree, (type) => type === lucideType);
    expect(defaultLucide?.props.color).toBe('currentColor');

    const coloredTree = callIconNode({ icon: 'shopping-cart', color: 'blue' });
    const coloredLucide = findElement(coloredTree, (type) => type === lucideType);
    // 'blue' token resolves to the saturated edge HSL — color-tokens.ts:24.
    expect(coloredLucide?.props.color).toBe('hsl(217, 91%, 60%)');
  });

  it('ResizeControls fires data.onResize on resize end with width/height/x/y', () => {
    const onResize = mock(() => {});
    const setResizing = mock(() => {});
    const tree = callIconNode({ icon: 'shopping-cart', onResize, setResizing }, {
      selected: true,
    } as Partial<NodeProps>);
    const controls = findElement(tree, (type) => type === ResizeControls);
    if (!controls) throw new Error('ResizeControls not found in IconNode tree');
    const props = controls.props as {
      visible: boolean;
      onResizeStart: () => void;
      onResizeEnd: (
        e: unknown,
        params: { width: number; height: number; x: number; y: number },
      ) => void;
    };
    expect(props.visible).toBe(true);

    props.onResizeStart();
    expect(setResizing).toHaveBeenCalledWith(true);

    props.onResizeEnd(undefined, { width: 100, height: 80, x: 10, y: 20 });
    expect(setResizing).toHaveBeenCalledWith(false);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith('n1', { width: 100, height: 80, x: 10, y: 20 });
  });

  it('dblclick dispatches onRequestIconReplace with the node id and stops propagation', () => {
    // US-016: double-click an iconNode → open the picker in replace mode.
    const onRequestIconReplace = mock(() => {});
    // The tree's root element IS the wrapper div, so we inspect its
    // onDoubleClick prop directly. No need to walk — `callIconNode` returns
    // the JSX returned by IconNode, which is the wrapper.
    const tree = callIconNode({ icon: 'shopping-cart', onRequestIconReplace }, {
      id: 'icon-42',
    } as Partial<NodeProps>);
    if (!isElement(tree)) throw new Error('IconNode did not return a React element');
    expect(tree.props['data-testid']).toBe('icon-node');
    const onDoubleClick = tree.props.onDoubleClick as
      | ((e: { stopPropagation: () => void }) => void)
      | undefined;
    expect(onDoubleClick).toBeDefined();

    // Verify stopPropagation is called BEFORE the dispatch (matches the
    // PRD's "wrapping div with its own onDoubleClick spy" — under the
    // hook-shim there's no real DOM event, so we approximate by spying on
    // stopPropagation directly; a real wrapping listener wouldn't fire if
    // stopPropagation is called on the event).
    const stopPropagation = mock(() => {});
    onDoubleClick?.({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onRequestIconReplace).toHaveBeenCalledTimes(1);
    expect(onRequestIconReplace).toHaveBeenCalledWith('icon-42');
  });

  it('dblclick is a no-op (and does NOT stop propagation) when onRequestIconReplace is absent', () => {
    // Read-only / no-demo contexts don't wire the callback; the wrapper
    // should still render with an onDoubleClick handler, but the handler
    // bails before stopPropagation so a wrapping listener (e.g. the canvas
    // dblclick-to-create-shape handler) still gets to run.
    const tree = callIconNode({ icon: 'shopping-cart' });
    if (!isElement(tree)) throw new Error('IconNode did not return a React element');
    const onDoubleClick = tree.props.onDoubleClick as
      | ((e: { stopPropagation: () => void }) => void)
      | undefined;
    expect(onDoubleClick).toBeDefined();

    const stopPropagation = mock(() => {});
    onDoubleClick?.({ stopPropagation });
    expect(stopPropagation).not.toHaveBeenCalled();
  });
});
