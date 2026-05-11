import { describe, expect, it, mock } from 'bun:test';
import { InlineEdit } from '@/components/inline-edit';
import { GROUP_DEFAULT_SIZE, GroupNode, groupChromeStyle } from '@/components/nodes/group-node';
import { ResizeControls } from '@/components/nodes/resize-controls';
import { colorTokenStyle } from '@/lib/color-tokens';
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

function callGroupNode(
  data: Record<string, unknown>,
  overrides: Partial<NodeProps> = {},
  useStateOverrides?: ReadonlyArray<unknown>,
): unknown {
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
  return renderWithHooks(() => impl(props), useStateOverrides);
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

  it('renders data-active="true" on the root when data.isActive is set', () => {
    // The CSS rule
    // `.react-flow__node-group:has(> [data-testid='group-node'][data-active='true'])`
    // styles the entered group with a solid accent border + soft tint. The
    // GroupNode emits the data-active attribute only when isActive is true so
    // the selector doesn't fire for idle groups.
    const tree = callGroupNode({ isActive: true });
    if (!isElement(tree)) throw new Error('expected element');
    expect((tree.props as { 'data-active'?: string })['data-active']).toBe('true');
  });

  it('omits data-active on the root when data.isActive is falsy', () => {
    const tree = callGroupNode({});
    if (!isElement(tree)) throw new Error('expected element');
    expect((tree.props as { 'data-active'?: string })['data-active']).toBeUndefined();
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

describe('GroupNode label editing (US-014)', () => {
  // useStateOverrides indexing: useResizeGesture consumes slot 0 (isResizing),
  // so the GroupNode's own `isEditing` is slot 1. Pass `[undefined, true]` to
  // force the edit-mode branch in the renderer.
  const editingOverrides = [undefined, true] as const;

  it('read mode: label slot renders the label text and no InlineEdit when onLabelChange is absent', () => {
    const tree = callGroupNode({ label: 'Auth flow' });
    const slot = findLabel(tree)[0];
    if (!slot) throw new Error('label slot missing');
    expect(slot.props.children).toBe('Auth flow');
    const inlineEditEls = findAll(tree, (el) => el.type === InlineEdit);
    expect(inlineEditEls).toHaveLength(0);
  });

  it('does NOT enter edit mode when onLabelChange is absent (readonly contexts)', () => {
    // No onLabelChange → click on the slot is a no-op (still renders label text).
    const tree = callGroupNode({ label: 'Read only' });
    const slot = findLabel(tree)[0];
    if (!slot) throw new Error('label slot missing');
    // Click handler is wired but the early return prevents setIsEditing.
    // Verifying the handler is present is enough — we cannot drive state
    // mutations through the hook-shim setter.
    expect(typeof (slot.props as { onClick?: unknown }).onClick).toBe('function');
    // No edit-mode artifact rendered.
    expect((slot.props as { 'data-editing'?: string })['data-editing']).toBeUndefined();
    const inlineEditEls = findAll(tree, (el) => el.type === InlineEdit);
    expect(inlineEditEls).toHaveLength(0);
  });

  it('exposes a click-to-edit affordance on the label slot when onLabelChange is wired', () => {
    const onLabelChange = mock(() => {});
    const tree = callGroupNode({ label: 'Pipeline', onLabelChange });
    const slot = findLabel(tree)[0];
    if (!slot) throw new Error('label slot missing');
    expect(typeof (slot.props as { onClick?: unknown }).onClick).toBe('function');
    // cursor-text utility flips on so the slot looks editable on hover.
    expect(String(slot.props.className ?? '')).toContain('cursor-text');
  });

  it('edit mode: renders InlineEdit pre-populated with the current label', () => {
    const onLabelChange = mock(() => {});
    const tree = callGroupNode({ label: 'Pipeline', onLabelChange }, undefined, editingOverrides);
    const slot = findLabel(tree)[0];
    if (!slot) throw new Error('label slot missing');
    // The slot's data-editing flag flips true while editing.
    expect((slot.props as { 'data-editing'?: string })['data-editing']).toBe('true');
    const inlineEditEls = findAll(tree, (el) => el.type === InlineEdit);
    expect(inlineEditEls).toHaveLength(1);
    const ieProps = inlineEditEls[0]?.props as
      | { initialValue?: string; field?: string; placeholder?: string }
      | undefined;
    expect(ieProps?.initialValue).toBe('Pipeline');
    expect(ieProps?.field).toBe('group-node-label');
    expect(ieProps?.placeholder).toBe('Group label');
  });

  it('edit mode with empty label: InlineEdit receives an empty initialValue', () => {
    const onLabelChange = mock(() => {});
    const tree = callGroupNode({ onLabelChange }, undefined, editingOverrides);
    const inlineEditEls = findAll(tree, (el) => el.type === InlineEdit);
    expect(inlineEditEls).toHaveLength(1);
    const ieProps = inlineEditEls[0]?.props as { initialValue?: string };
    expect(ieProps.initialValue).toBe('');
  });

  it('edit mode: InlineEdit onCommit calls data.onLabelChange with the node id and new value', () => {
    const onLabelChange = mock((_id: string, _label: string) => {});
    const tree = callGroupNode({ label: 'Old', onLabelChange }, undefined, editingOverrides);
    const ie = findAll(tree, (el) => el.type === InlineEdit)[0];
    if (!ie) throw new Error('InlineEdit not found');
    (ie.props as { onCommit: (v: string) => void }).onCommit('New label');
    expect(onLabelChange).toHaveBeenCalledWith('group-1', 'New label');
  });

  it('edit mode: empty-string commit clears the label (parity with US-002 sentinel)', () => {
    const onLabelChange = mock((_id: string, _label: string) => {});
    const tree = callGroupNode({ label: 'Old', onLabelChange }, undefined, editingOverrides);
    const ie = findAll(tree, (el) => el.type === InlineEdit)[0];
    if (!ie) throw new Error('InlineEdit not found');
    (ie.props as { onCommit: (v: string) => void }).onCommit('');
    expect(onLabelChange).toHaveBeenCalledWith('group-1', '');
  });

  it('edit mode: ResizeControls are hidden while editing (mirrors icon-node US-004)', () => {
    const onLabelChange = mock(() => {});
    const onResize = mock(() => {});
    const tree = callGroupNode(
      { onResize, onLabelChange },
      { selected: true } as Partial<NodeProps>,
      editingOverrides,
    );
    const controls = findElement(tree, (type) => type === ResizeControls);
    if (!controls) throw new Error('ResizeControls not found');
    expect((controls.props as { visible: boolean }).visible).toBe(false);
  });

  it('edit mode: the read-mode label text is replaced by the editor (no duplicate label DOM)', () => {
    const onLabelChange = mock(() => {});
    const tree = callGroupNode({ label: 'Pipeline', onLabelChange }, undefined, editingOverrides);
    const slot = findLabel(tree)[0];
    if (!slot) throw new Error('label slot missing');
    // The slot's only child should be the InlineEdit element, NOT the raw
    // label string.
    const child = slot.props.children;
    expect(child).not.toBe('Pipeline');
  });
});

describe('GroupNode style fields (US-005)', () => {
  // US-005: when data exposes any of the persisted style fields
  // (backgroundColor / borderColor / borderWidth / borderStyle), they render
  // as inline styles on the outer div. Unset fields fall through to the
  // default CSS chrome (.react-flow__node-group: 1px dashed, transparent).
  it('applies no chrome-style keys when all style fields are absent', () => {
    // sized=false (no width/height) so the inline style still carries the
    // GROUP_DEFAULT_SIZE block but contains NO chrome keys — proves the
    // helper only emits keys for set fields.
    const tree = callGroupNode({});
    if (!isElement(tree)) throw new Error('expected element');
    const style = tree.props.style as Record<string, unknown> | undefined;
    if (!style) throw new Error('expected an inline style block (GROUP_DEFAULT_SIZE)');
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderColor).toBeUndefined();
    expect(style.borderWidth).toBeUndefined();
    expect(style.borderStyle).toBeUndefined();
    // GROUP_DEFAULT_SIZE block still applies — the absence-of-chrome assertion
    // must not regress the existing default-size behavior.
    expect(style.width).toBe(GROUP_DEFAULT_SIZE.width);
    expect(style.height).toBe(GROUP_DEFAULT_SIZE.height);
  });

  it('applies all four style fields via inline style when set', () => {
    const tree = callGroupNode({
      backgroundColor: 'blue',
      borderColor: 'amber',
      borderWidth: 3,
      borderStyle: 'dashed',
    });
    if (!isElement(tree)) throw new Error('expected element');
    const style = tree.props.style as Record<string, unknown> | undefined;
    if (!style) throw new Error('expected inline style');
    // Color tokens resolve via colorTokenStyle('node') — match those exact
    // values rather than hard-coding HSL strings here.
    expect(style.backgroundColor).toBe(colorTokenStyle('blue', 'node').backgroundColor);
    expect(style.borderColor).toBe(colorTokenStyle('amber', 'node').borderColor);
    expect(style.borderWidth).toBe(3);
    expect(style.borderStyle).toBe('dashed');
  });

  it('applies a partial set (borderWidth only) without polluting other keys', () => {
    const tree = callGroupNode({ borderWidth: 5 });
    if (!isElement(tree)) throw new Error('expected element');
    const style = tree.props.style as Record<string, unknown> | undefined;
    if (!style) throw new Error('expected inline style');
    expect(style.borderWidth).toBe(5);
    // Other chrome keys remain absent so the CSS default still wins.
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderColor).toBeUndefined();
    expect(style.borderStyle).toBeUndefined();
  });

  it('applies chrome style even when sized (wrapper owns width/height)', () => {
    // sized=true (data.width set) → previous behavior was style=undefined.
    // With chrome fields set, the inline style now carries ONLY chrome keys
    // (no width/height — wrapper still owns dimensions).
    const tree = callGroupNode({
      width: 400,
      height: 300,
      backgroundColor: 'green',
      borderStyle: 'solid',
    });
    if (!isElement(tree)) throw new Error('expected element');
    const style = tree.props.style as Record<string, unknown> | undefined;
    if (!style) throw new Error('expected inline style with chrome keys');
    expect(style.backgroundColor).toBe(colorTokenStyle('green', 'node').backgroundColor);
    expect(style.borderStyle).toBe('solid');
    // Wrapper owns dimensions — no width/height inline.
    expect(style.width).toBeUndefined();
    expect(style.height).toBeUndefined();
  });

  it('returns undefined inline style when sized AND no chrome fields set', () => {
    // Regression: pre-US-005 behavior. sized + no chrome → no inline style at
    // all (avoids redundant style block).
    const tree = callGroupNode({ width: 400, height: 300 });
    if (!isElement(tree)) throw new Error('expected element');
    expect(tree.props.style).toBeUndefined();
  });

  it('groupChromeStyle helper returns an empty object for empty input', () => {
    expect(groupChromeStyle({})).toEqual({});
  });

  it('groupChromeStyle helper resolves color tokens and passes width/style through', () => {
    const result = groupChromeStyle({
      backgroundColor: 'pink',
      borderColor: 'purple',
      borderWidth: 2,
      borderStyle: 'dotted',
    });
    expect(result.backgroundColor).toBe(colorTokenStyle('pink', 'node').backgroundColor);
    expect(result.borderColor).toBe(colorTokenStyle('purple', 'node').borderColor);
    expect(result.borderWidth).toBe(2);
    expect(result.borderStyle).toBe('dotted');
  });
});
