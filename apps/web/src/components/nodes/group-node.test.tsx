import { describe, expect, it, mock } from 'bun:test';
import { GROUP_DEFAULT_SIZE, GroupNode } from '@/components/nodes/group-node';
import { ResizeControls } from '@/components/nodes/resize-controls';
import type { NodeProps } from '@xyflow/react';
import * as React from 'react';

// Hook-shim harness (mirrors icon-node.test.tsx) — Bun runs apps/web tests
// without a DOM so we shim React's internal dispatcher and call GroupNode as a
// function. Resize controls etc. are captured as `{ type, props }` placeholders
// without executing their render bodies.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

function renderWithHooks<T>(fn: () => T, useStateOverrides?: ReadonlyArray<unknown>): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  let useStateIndex = 0;
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const idx = useStateIndex++;
      const override = useStateOverrides?.[idx];
      if (override !== undefined) return [override as S, () => {}];
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

function findAll(tree: unknown, predicate: (el: ReactElementLike) => boolean): ReactElementLike[] {
  const out: ReactElementLike[] = [];
  const visit = (node: unknown) => {
    if (!isElement(node)) return;
    if (predicate(node)) out.push(node);
    const children = node.props.children;
    if (children === undefined || children === null) return;
    const arr = Array.isArray(children) ? children : [children];
    for (const c of arr) visit(c);
  };
  visit(tree);
  return out;
}

function callGroupNode(data: Record<string, unknown>, overrides: Partial<NodeProps> = {}): unknown {
  const props = {
    id: 'group-1',
    type: 'group',
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
  const impl = (GroupNode as unknown as { type: (p: NodeProps) => unknown }).type;
  return renderWithHooks(() => impl(props));
}

const findLabel = (tree: unknown) =>
  findAll(
    tree,
    (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'group-node-label',
  );

describe('GroupNode (US-011)', () => {
  it('renders an empty label slot when data.label is absent', () => {
    const tree = callGroupNode({});
    const labels = findLabel(tree);
    expect(labels).toHaveLength(1);
    const slot = labels[0];
    if (!slot) throw new Error('group-node-label not found');
    // Empty slot renders null children so the strip is still present (so the
    // ~28px reserved height stays constant) without painting any text.
    expect(slot.props.children).toBeNull();
    // The slot's reserved height matches the AC's "empty ~28px tall strip".
    expect((slot.props.style as { height?: number })?.height).toBe(28);
  });

  it('renders the label text in the slot when data.label is set', () => {
    const tree = callGroupNode({ label: 'Auth flow' });
    const labels = findLabel(tree);
    expect(labels).toHaveLength(1);
    const slot = labels[0];
    if (!slot) throw new Error('group-node-label not found');
    expect(slot.props.children).toBe('Auth flow');
  });

  it('treats an empty-string label as no label (parity with US-002 sentinel)', () => {
    const tree = callGroupNode({ label: '' });
    const labels = findLabel(tree);
    expect(labels).toHaveLength(1);
    expect(labels[0]?.props.children).toBeNull();
  });

  it('pins the default GROUP_DEFAULT_SIZE when no width/height is set', () => {
    const tree = callGroupNode({});
    if (!isElement(tree)) throw new Error('expected element');
    const style = tree.props.style as { width?: number; height?: number } | undefined;
    expect(style?.width).toBe(GROUP_DEFAULT_SIZE.width);
    expect(style?.height).toBe(GROUP_DEFAULT_SIZE.height);
  });

  it('lets the React Flow wrapper own dimensions when width/height are set in data', () => {
    const tree = callGroupNode({ width: 400, height: 300 });
    if (!isElement(tree)) throw new Error('expected element');
    // sized → no inline width/height (wrapper fills via h-full w-full).
    expect(tree.props.style).toBeUndefined();
    const className = String(tree.props.className ?? '');
    expect(className).toContain('h-full');
    expect(className).toContain('w-full');
  });

  it('renders ResizeControls visible when selected and onResize is wired', () => {
    const onResize = mock(() => {});
    const tree = callGroupNode({ onResize }, { selected: true } as Partial<NodeProps>);
    const controls = findElement(tree, (type) => type === ResizeControls);
    if (!controls) throw new Error('ResizeControls not found');
    const props = controls.props as { visible: boolean };
    expect(props.visible).toBe(true);
  });

  it('hides ResizeControls when not selected', () => {
    const onResize = mock(() => {});
    const tree = callGroupNode({ onResize });
    const controls = findElement(tree, (type) => type === ResizeControls);
    if (!controls) throw new Error('ResizeControls not found');
    expect((controls.props as { visible: boolean }).visible).toBe(false);
  });

  it('hides ResizeControls when data.onResize is absent (read-only contexts)', () => {
    const tree = callGroupNode({}, { selected: true } as Partial<NodeProps>);
    const controls = findElement(tree, (type) => type === ResizeControls);
    if (!controls) throw new Error('ResizeControls not found');
    expect((controls.props as { visible: boolean }).visible).toBe(false);
  });

  it('forwards resize-stop dims to data.onResize with the node id', () => {
    const onResize = mock(() => {});
    const setResizing = mock(() => {});
    const tree = callGroupNode({ onResize, setResizing }, {
      selected: true,
    } as Partial<NodeProps>);
    const controls = findElement(tree, (type) => type === ResizeControls);
    if (!controls) throw new Error('ResizeControls not found');
    const cprops = controls.props as {
      onResizeStart: () => void;
      onResizeEnd: (
        e: unknown,
        params: { width: number; height: number; x: number; y: number },
      ) => void;
    };
    cprops.onResizeStart();
    cprops.onResizeEnd({}, { width: 500, height: 350, x: 10, y: 20 });
    expect(onResize).toHaveBeenCalledWith('group-1', { width: 500, height: 350, x: 10, y: 20 });
  });
});
