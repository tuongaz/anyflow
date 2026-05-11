import { beforeEach, describe, expect, it } from 'bun:test';
import type { DemoNode } from '@/lib/api';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// US-019: the DetailPanel root reads localStorage on first render
// (getStoredDetailPanelWidth) and writes back on resize. Provide a Map-backed
// localStorage so the imports below see a `window` global.
const memStore = new Map<string, string>();
const mockLocalStorage = {
  getItem: (k: string): string | null => memStore.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    memStore.set(k, v);
  },
  removeItem: (k: string): void => {
    memStore.delete(k);
  },
};

type WindowListener = (e: { clientX: number }) => void;
const windowListeners = new Map<string, WindowListener[]>();
const mockWindow = {
  localStorage: mockLocalStorage,
  addEventListener: (event: string, cb: WindowListener) => {
    const arr = windowListeners.get(event) ?? [];
    arr.push(cb);
    windowListeners.set(event, arr);
  },
  removeEventListener: (event: string, cb: WindowListener) => {
    const arr = windowListeners.get(event) ?? [];
    windowListeners.set(
      event,
      arr.filter((c) => c !== cb),
    );
  },
};
(globalThis as { window?: typeof mockWindow }).window = mockWindow;

const { DescriptionMarkdown, DetailPanel, EditableDescription } = await import(
  '@/components/detail-panel'
);
const { DETAIL_PANEL_WIDTH_KEY } = await import('@/lib/detail-panel-width');

// Same dispatcher-shim trick used by icon-node.test.tsx and
// icon-picker-popover.test.tsx — apps/web tests run without a DOM, so we shim
// React's internal hook dispatcher and call the component as a function. The
// returned tree is the first render with sub-components (Sheet/SheetContent)
// captured as placeholders.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

/**
 * `useStateOverrides`, when provided, replaces the Nth useState call's initial
 * value with the corresponding entry from the array (undefined = passthrough).
 * Setter is a no-op — tests observe a post-setter render by calling the
 * renderer again with the desired override.
 */
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

function findAll(tree: unknown, predicate: (el: ReactElementLike) => boolean): ReactElementLike[] {
  const out: ReactElementLike[] = [];
  const visit = (n: unknown) => {
    if (!isElement(n)) return;
    if (predicate(n)) out.push(n);
    const children = n.props.children;
    if (children === undefined || children === null) return;
    const arr = Array.isArray(children) ? children : [children];
    for (const c of arr) visit(c);
  };
  visit(tree);
  return out;
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

// The hook-shim renders sub-component bodies as placeholders, so a `data-testid`
// can land either on `props['data-testid']` (plain DOM nodes) or `props.testId`
// (sub-component placeholders that haven't executed). Match either form.
function testIdEquals(id: string) {
  return (el: ReactElementLike) => {
    const p = el.props as { 'data-testid'?: string; testId?: string };
    return p['data-testid'] === id || p.testId === id;
  };
}

function makeIconNode(
  overrides: Partial<Extract<DemoNode, { type: 'iconNode' }>['data']> = {},
  id = 'n1',
): Extract<DemoNode, { type: 'iconNode' }> {
  return {
    id,
    type: 'iconNode',
    position: { x: 0, y: 0 },
    data: {
      icon: 'shopping-cart',
      ...overrides,
    },
  };
}

// US-022: iconNode no longer opens the detail panel — assert the panel
// renders no content when an iconNode is selected (Sheet is closed; the
// resize handle still lives inside SheetContent for the resize tests below).
describe('DetailPanel — iconNode is decorative', () => {
  type PanelProps = Parameters<typeof DetailPanel>[0];
  it('does not render the iconNode section anymore', () => {
    const node = makeIconNode();
    const props: PanelProps = {
      demoId: 'demo-1',
      node,
      connector: null,
      onClose: () => {},
    } as PanelProps;
    const tree = renderWithHooks(() =>
      (DetailPanel as unknown as (p: PanelProps) => unknown)(props),
    );
    // Legacy IconNodeSection test ids must not appear anywhere in the tree —
    // selecting an iconNode is now a no-op for the panel.
    expect(findElement(tree, testIdEquals('detail-panel-icon-node'))).toBeNull();
    expect(findElement(tree, testIdEquals('detail-panel-change-icon'))).toBeNull();
    expect(findElement(tree, testIdEquals('detail-panel-icon-preview'))).toBeNull();
  });
});

// US-017: DescriptionMarkdown is rendered via react-dom/server because the
// hook-shim renderer treats ReactMarkdown as a placeholder and never executes
// the GFM transform. renderToStaticMarkup is DOM-free string rendering, and
// react-markdown has no zustand/React-Flow ancestor requirement — so it works
// in Bun's no-DOM test environment.
describe('DescriptionMarkdown', () => {
  it('renders bold markdown as a <strong> element', () => {
    const html = renderToStaticMarkup(<DescriptionMarkdown source="hello **world**" />);
    expect(html).toContain('<strong>world</strong>');
  });

  it('renders an inline link with target=_blank rel=noopener noreferrer', () => {
    const html = renderToStaticMarkup(
      <DescriptionMarkdown source="see [the docs](https://example.com)" />,
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renders a fenced code block as <pre><code>', () => {
    const html = renderToStaticMarkup(<DescriptionMarkdown source={'```\nconst x = 1;\n```'} />);
    expect(html).toMatch(/<pre[^>]*><code[^>]*>const x = 1;\n<\/code><\/pre>/);
  });

  it('renders GFM strikethrough as <del>', () => {
    const html = renderToStaticMarkup(<DescriptionMarkdown source="this is ~~gone~~" />);
    expect(html).toContain('<del>gone</del>');
  });

  it('does not render raw HTML (rehype-raw is disabled)', () => {
    const html = renderToStaticMarkup(
      <DescriptionMarkdown source="hi <script>alert(1)</script>" />,
    );
    // The <script> tag must be HTML-escaped to inert text, not passed through
    // as an executable element. Escaped form (&lt;script&gt;) is the safe
    // rendering; an unescaped <script> would be an XSS risk.
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders inline code as <code> without wrapping <pre>', () => {
    const html = renderToStaticMarkup(<DescriptionMarkdown source="run `npm install`" />);
    expect(html).toMatch(/<code[^>]*>npm install<\/code>/);
    expect(html).not.toMatch(/<pre[^>]*><code[^>]*>npm install/);
  });

  it('wraps output in the description container with the test id', () => {
    const html = renderToStaticMarkup(<DescriptionMarkdown source="hello" />);
    expect(html).toContain('data-testid="detail-panel-description"');
  });
});

// US-019: DetailPanel root is rendered via the hook-shim — Sheet/SheetContent
// are captured as placeholders, so we can find the SheetContent by testId and
// inspect its `style` (the --detail-panel-w variable) and its first child
// (the resize handle).
describe('DetailPanel resize', () => {
  type PanelProps = Parameters<typeof DetailPanel>[0];
  function callPanel(overrides: Partial<PanelProps> = {}) {
    const node = makeIconNode();
    const props: PanelProps = {
      demoId: 'demo-1',
      node,
      connector: null,
      onClose: () => {},
      ...overrides,
    } as PanelProps;
    return renderWithHooks(() => (DetailPanel as unknown as (p: PanelProps) => unknown)(props));
  }

  beforeEach(() => {
    memStore.clear();
    windowListeners.clear();
  });

  it('renders SheetContent with the default 380px width CSS variable', () => {
    const tree = callPanel();
    const content = findElement(tree, testIdEquals('detail-panel'));
    if (!content) throw new Error('detail-panel SheetContent not found');
    const style = content.props.style as Record<string, string>;
    expect(style['--detail-panel-w']).toBe('380px');
  });

  it('hydrates initial width from localStorage when within [MIN, MAX]', () => {
    memStore.set(DETAIL_PANEL_WIDTH_KEY, '560');
    const tree = callPanel();
    const content = findElement(tree, testIdEquals('detail-panel'));
    if (!content) throw new Error('detail-panel SheetContent not found');
    const style = content.props.style as Record<string, string>;
    expect(style['--detail-panel-w']).toBe('560px');
  });

  it('renders a resize handle on the left edge with onPointerDown wired', () => {
    const tree = callPanel();
    const handle = findElement(tree, testIdEquals('detail-panel-resize-handle'));
    if (!handle) throw new Error('resize handle not found');
    expect(typeof handle.props.onPointerDown).toBe('function');
    // Handle is hidden below sm and discoverable on hover above sm.
    const className = handle.props.className as string;
    expect(className).toContain('hidden');
    expect(className).toContain('sm:block');
    expect(className).toContain('cursor-col-resize');
  });

  it('drag end persists the new width to localStorage', () => {
    const tree = callPanel();
    const handle = findElement(tree, testIdEquals('detail-panel-resize-handle'));
    if (!handle) throw new Error('resize handle not found');
    const onPointerDown = handle.props.onPointerDown as (
      e: ReactPointerEvent<HTMLDivElement>,
    ) => void;
    // Start a drag at clientX=1000 (handle's pixel column).
    onPointerDown({
      preventDefault: () => {},
      clientX: 1000,
    } as unknown as ReactPointerEvent<HTMLDivElement>);
    // The handler attached window listeners — fire move then up.
    const movers = windowListeners.get('pointermove') ?? [];
    const ups = windowListeners.get('pointerup') ?? [];
    expect(movers).toHaveLength(1);
    expect(ups).toHaveLength(1);
    // Drag 100px to the LEFT — panel widens by 100 (380 → 480).
    for (const cb of movers) cb({ clientX: 900 });
    // Release the pointer — commit the final width.
    for (const cb of ups) cb({ clientX: 900 });
    expect(memStore.get(DETAIL_PANEL_WIDTH_KEY)).toBe('480');
    // Listeners cleaned up.
    expect(windowListeners.get('pointermove') ?? []).toHaveLength(0);
    expect(windowListeners.get('pointerup') ?? []).toHaveLength(0);
  });
});

// US-005: EditableDescription — pencil affordance, edit mode, save, cancel.
describe('EditableDescription (US-005)', () => {
  type Props = Parameters<typeof EditableDescription>[0];

  it('renders the rendered markdown with no chrome when onSave is omitted', () => {
    const tree = renderWithHooks(() =>
      (EditableDescription as unknown as (p: Props) => unknown)({
        nodeId: 'n1',
        source: 'hello **world**',
      } as Props),
    );
    // Read-only mode: the top-level node IS the DescriptionMarkdown component
    // (no group/relative wrapper) — assert by component identity, since the
    // hook-shim captures sub-components as placeholders and the inner
    // data-testid lives inside DescriptionMarkdown's body, which doesn't run.
    expect(isElement(tree) && tree.type === DescriptionMarkdown).toBe(true);
    expect(findElement(tree, testIdEquals('detail-panel-description-edit'))).toBeNull();
    expect(findElement(tree, testIdEquals('detail-panel-description-save'))).toBeNull();
    expect(findElement(tree, testIdEquals('detail-panel-description-block'))).toBeNull();
  });

  it('renders the rendered markdown plus a hover-revealed pencil when onSave is wired', () => {
    const tree = renderWithHooks(() =>
      (EditableDescription as unknown as (p: Props) => unknown)({
        nodeId: 'n1',
        source: 'hello',
        onSave: () => {},
      } as Props),
    );
    const block = findElement(tree, testIdEquals('detail-panel-description-block'));
    if (!block) throw new Error('description block wrapper not found');
    expect(block.props['data-editing']).toBe('false');
    // The block's class enables CSS group-hover so the descendant pencil
    // reveals on hover without an extra JS listener.
    expect((block.props.className as string).includes('group')).toBe(true);

    const edit = findElement(tree, testIdEquals('detail-panel-description-edit'));
    if (!edit) throw new Error('edit (pencil) button not found');
    // Pencil is low-opacity by default and lifts to 100% on hover/focus of
    // the wrapping block — fulfills the "low opacity by default, full
    // opacity on hover/focus" acceptance criterion.
    const editClass = edit.props.className as string;
    expect(editClass).toContain('opacity-30');
    expect(editClass).toContain('group-hover:opacity-100');
    expect(editClass).toContain('group-focus-within:opacity-100');
    expect(edit.props['aria-label']).toBe('Edit description');
    expect(typeof edit.props.onClick).toBe('function');

    // No save button until edit mode.
    expect(findElement(tree, testIdEquals('detail-panel-description-save'))).toBeNull();
    expect(findElement(tree, testIdEquals('detail-panel-description-textarea'))).toBeNull();
  });

  it('renders the textarea + save button in edit mode', () => {
    // The component's first two useState calls are `isEditing` and `draft`.
    // Force isEditing=true, draft='draft body' to render edit mode.
    const tree = renderWithHooks(
      () =>
        (EditableDescription as unknown as (p: Props) => unknown)({
          nodeId: 'n1',
          source: 'original',
          onSave: () => {},
        } as Props),
      [true, 'draft body'],
    );
    const block = findElement(tree, testIdEquals('detail-panel-description-block'));
    if (!block) throw new Error('description block wrapper not found');
    expect(block.props['data-editing']).toBe('true');

    const textarea = findElement(tree, testIdEquals('detail-panel-description-textarea'));
    if (!textarea) throw new Error('textarea not found');
    expect(textarea.props.value).toBe('draft body');
    expect(typeof textarea.props.onChange).toBe('function');
    expect(typeof textarea.props.onKeyDown).toBe('function');
    expect(typeof textarea.props.onBlur).toBe('function');

    const save = findElement(tree, testIdEquals('detail-panel-description-save'));
    if (!save) throw new Error('save (check) button not found');
    expect(save.props['aria-label']).toBe('Save description');
    expect(typeof save.props.onClick).toBe('function');
    expect(typeof save.props.onMouseDown).toBe('function');

    // Pencil and the read-mode markdown component are gone while editing.
    expect(findElement(tree, testIdEquals('detail-panel-description-edit'))).toBeNull();
    expect(findAll(tree, (el) => el.type === DescriptionMarkdown).length).toBe(0);
  });

  it('save button onClick commits the current draft via onSave(nodeId, value)', () => {
    const calls: Array<{ nodeId: string; value: string }> = [];
    const onSave = (nodeId: string, value: string) => calls.push({ nodeId, value });
    const tree = renderWithHooks(
      () =>
        (EditableDescription as unknown as (p: Props) => unknown)({
          nodeId: 'node-42',
          source: 'old',
          onSave,
        } as Props),
      [true, 'new body'],
    );
    const save = findElement(tree, testIdEquals('detail-panel-description-save'));
    if (!save) throw new Error('save button not found');
    (save.props.onClick as () => void)();
    expect(calls).toEqual([{ nodeId: 'node-42', value: 'new body' }]);
  });

  it('Escape in the textarea cancels via onKeyDown (no commit, stops propagation)', () => {
    // The component's React onKeyDown handles Escape locally — preventDefault
    // (so the browser's native Escape doesn't reset the textarea), stop
    // propagation (so canvas-level Backspace/Delete handling doesn't react),
    // and roll back to read mode without firing onSave. Sheet-level
    // Escape-to-close suppression is layered separately via SheetContent's
    // onEscapeKeyDown (see DetailPanel) — exercised via the US-005 browser
    // verification.
    const calls: Array<{ nodeId: string; value: string }> = [];
    const onSave = (nodeId: string, value: string) => calls.push({ nodeId, value });
    const tree = renderWithHooks(
      () =>
        (EditableDescription as unknown as (p: Props) => unknown)({
          nodeId: 'n1',
          source: 'kept',
          onSave,
        } as Props),
      [true, 'discarded'],
    );
    const textarea = findElement(tree, testIdEquals('detail-panel-description-textarea'));
    if (!textarea) throw new Error('textarea not found');
    let preventedDefault = false;
    let stoppedPropagation = false;
    const fakeEvent = {
      key: 'Escape',
      preventDefault: () => {
        preventedDefault = true;
      },
      stopPropagation: () => {
        stoppedPropagation = true;
      },
    };
    (textarea.props.onKeyDown as (e: unknown) => void)(fakeEvent);
    expect(preventedDefault).toBe(true);
    expect(stoppedPropagation).toBe(true);
    expect(calls).toEqual([]);
  });

  it('blur cancels (does not commit) when the suppress flag is not armed', () => {
    const calls: Array<{ nodeId: string; value: string }> = [];
    const onSave = (nodeId: string, value: string) => calls.push({ nodeId, value });
    const tree = renderWithHooks(
      () =>
        (EditableDescription as unknown as (p: Props) => unknown)({
          nodeId: 'n1',
          source: 'kept',
          onSave,
        } as Props),
      [true, 'discarded'],
    );
    const textarea = findElement(tree, testIdEquals('detail-panel-description-textarea'));
    if (!textarea) throw new Error('textarea not found');
    (textarea.props.onBlur as () => void)();
    // Blur path on its own discards — no onSave invocation.
    expect(calls).toEqual([]);
  });
});
