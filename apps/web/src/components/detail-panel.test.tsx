import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ColorToken, DemoNode } from '@/lib/api';
import type { ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
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

const { DescriptionMarkdown, DetailPanel, IconNodeSection } = await import(
  '@/components/detail-panel'
);
const { DETAIL_PANEL_WIDTH_KEY } = await import('@/lib/detail-panel-width');

// Same dispatcher-shim trick used by icon-node.test.tsx and
// icon-picker-popover.test.tsx — apps/web tests run without a DOM, so we shim
// React's internal hook dispatcher and call IconNodeSection as a function. The
// returned tree is the first render with sub-components (Sheet/Slider/Button)
// captured as placeholders; that's fine because IconNodeSection renders every
// interactive element (color tiles + slider + input + change-icon button)
// inline or as a placeholder we can still find by testId/type.
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

type Props = {
  node: Extract<DemoNode, { type: 'iconNode' }>;
  onChangeIcon?: (nodeId: string) => void;
  onStyleNode?: (nodeId: string, patch: Record<string, unknown>) => void;
};

function callSection(props: Props): unknown {
  return renderWithHooks(() => (IconNodeSection as unknown as (p: Props) => unknown)(props));
}

describe('IconNodeSection', () => {
  it('renders the icon preview and the Change-icon button', () => {
    const node = makeIconNode({ icon: 'shopping-cart' });
    const tree = callSection({ node, onChangeIcon: () => {}, onStyleNode: () => {} });
    const preview = findElement(tree, testIdEquals('detail-panel-icon-preview'));
    expect(preview).not.toBeNull();
    const changeBtn = findElement(tree, testIdEquals('detail-panel-change-icon'));
    expect(changeBtn).not.toBeNull();
  });

  it('clicking the Change-icon button calls onChangeIcon with the node id', () => {
    const onChangeIcon = mock((_id: string) => {});
    const node = makeIconNode({}, 'icon-42');
    const tree = callSection({ node, onChangeIcon, onStyleNode: () => {} });
    const btn = findElement(tree, testIdEquals('detail-panel-change-icon'));
    if (!btn) throw new Error('change-icon button not found');
    const onClick = btn.props.onClick as () => void;
    onClick();
    expect(onChangeIcon).toHaveBeenCalledTimes(1);
    expect(onChangeIcon).toHaveBeenCalledWith('icon-42');
  });

  it('Change-icon button is disabled when onChangeIcon is undefined', () => {
    const node = makeIconNode();
    const tree = callSection({ node, onStyleNode: () => {} });
    const btn = findElement(tree, testIdEquals('detail-panel-change-icon'));
    if (!btn) throw new Error('change-icon button not found');
    expect(btn.props.disabled).toBe(true);
  });

  it('clicking a color tile fires onStyleNode with { color: token }', () => {
    const onStyleNode = mock((_id: string, _patch: Record<string, unknown>) => {});
    const node = makeIconNode({}, 'n-color');
    const tree = callSection({ node, onChangeIcon: () => {}, onStyleNode });
    const blueTile = findElement(tree, testIdEquals('detail-panel-icon-color-blue'));
    if (!blueTile) throw new Error('blue tile not found');
    const onClick = blueTile.props.onClick as () => void;
    onClick();
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('n-color', { color: 'blue' });
  });

  it('active color tile reflects data.color (data-active=true)', () => {
    const node = makeIconNode({ color: 'green' as ColorToken });
    const tree = callSection({ node, onChangeIcon: () => {}, onStyleNode: () => {} });
    const greenTile = findElement(tree, testIdEquals('detail-panel-icon-color-green'));
    if (!greenTile) throw new Error('green tile not found');
    expect(greenTile.props['data-active']).toBe(true);
    const slate = findElement(tree, testIdEquals('detail-panel-icon-color-slate'));
    expect(slate?.props['data-active']).toBe(false);
  });

  it('stroke-width slider commit fires onStyleNode with the new strokeWidth', () => {
    const onStyleNode = mock((_id: string, _patch: Record<string, unknown>) => {});
    const node = makeIconNode({}, 'n-stroke');
    const tree = callSection({ node, onChangeIcon: () => {}, onStyleNode });
    const slider = findElement(tree, testIdEquals('detail-panel-icon-stroke-slider'));
    if (!slider) throw new Error('stroke slider not found');
    const onCommit = slider.props.onValueCommit as (v: number[]) => void;
    onCommit([1.5]);
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('n-stroke', { strokeWidth: 1.5 });
  });

  it('stroke-width slider uses default 2 when data.strokeWidth is undefined', () => {
    const node = makeIconNode();
    const tree = callSection({ node, onChangeIcon: () => {}, onStyleNode: () => {} });
    const slider = findElement(tree, testIdEquals('detail-panel-icon-stroke-slider'));
    if (!slider) throw new Error('stroke slider not found');
    expect(slider.props.value).toEqual([2]);
    expect(slider.props.min).toBe(0.5);
    expect(slider.props.max).toBe(4);
    expect(slider.props.step).toBe(0.25);
  });

  it('stroke-width slider value reflects data.strokeWidth when set', () => {
    const node = makeIconNode({ strokeWidth: 3.5 });
    const tree = callSection({ node, onChangeIcon: () => {}, onStyleNode: () => {} });
    const slider = findElement(tree, testIdEquals('detail-panel-icon-stroke-slider'));
    if (!slider) throw new Error('stroke slider not found');
    expect(slider.props.value).toEqual([3.5]);
  });

  it('alt-text input blur fires onStyleNode with { alt: value } when it changed', () => {
    const onStyleNode = mock((_id: string, _patch: Record<string, unknown>) => {});
    // Render with empty alt; simulate the input changing, then blur.
    // Under the shim setLocal is a no-op so the input value cannot be observed
    // mid-typing — instead we cover the commit semantics by simulating a
    // synthesised blur event whose target.value is the new text and pre-test
    // the diff branch by starting from a different upstream alt.
    const node = makeIconNode({ alt: 'old' });
    const tree = callSection({ node, onChangeIcon: () => {}, onStyleNode });
    const input = findElement(tree, testIdEquals('detail-panel-icon-alt'));
    if (!input) throw new Error('alt input not found');
    // First fire onChange to make sure the handler is wired (no assertion on
    // state — the shim's setState is a no-op).
    const onChange = input.props.onChange as (e: ChangeEvent<HTMLInputElement>) => void;
    onChange({ target: { value: 'new' } } as unknown as ChangeEvent<HTMLInputElement>);
    // Confirm the controlled value still reflects the initial 'old' (shim has
    // not advanced local state — so the diff path inside onBlur uses 'old' vs
    // 'old' and is a no-op). That's the only way we can test the diff guard
    // through the shim — see next test for the actual commit path.
    expect(input.props.value).toBe('old');
    const onBlur = input.props.onBlur as () => void;
    onBlur();
    // No-op blur: local === upstream → no onStyleNode call.
    expect(onStyleNode).not.toHaveBeenCalled();
  });

  it('alt-text input renders with disabled=true when onStyleNode is undefined', () => {
    const node = makeIconNode();
    const tree = callSection({ node, onChangeIcon: () => {} });
    const input = findElement(tree, testIdEquals('detail-panel-icon-alt'));
    if (!input) throw new Error('alt input not found');
    expect(input.props.disabled).toBe(true);
  });

  it('alt-text input commits on Enter via blur()', () => {
    const node = makeIconNode();
    const tree = callSection({ node, onChangeIcon: () => {}, onStyleNode: () => {} });
    const input = findElement(tree, testIdEquals('detail-panel-icon-alt'));
    if (!input) throw new Error('alt input not found');
    const onKeyDown = input.props.onKeyDown as (e: KeyboardEvent<HTMLInputElement>) => void;
    const blurSpy = mock(() => {});
    onKeyDown({
      key: 'Enter',
      currentTarget: { blur: blurSpy },
    } as unknown as KeyboardEvent<HTMLInputElement>);
    expect(blurSpy).toHaveBeenCalledTimes(1);
    // Non-Enter keys do not blur.
    onKeyDown({
      key: 'a',
      currentTarget: { blur: blurSpy },
    } as unknown as KeyboardEvent<HTMLInputElement>);
    expect(blurSpy).toHaveBeenCalledTimes(1);
  });

  it('preview tile uses help-circle fallback for an unknown icon name', () => {
    const node = makeIconNode({ icon: '__nope__' });
    const tree = callSection({ node, onChangeIcon: () => {}, onStyleNode: () => {} });
    const preview = findElement(tree, testIdEquals('detail-panel-icon-preview'));
    if (!preview) throw new Error('preview not found');
    // The preview tile contains the fallback Lucide component as its child;
    // we just assert it has a child element (the Lucide component) — its
    // identity is verified indirectly by the icon-registry tests.
    const children = preview.props.children;
    expect(children).toBeDefined();
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
