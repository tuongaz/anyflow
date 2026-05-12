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

const {
  DescriptionMarkdown,
  DetailPanel,
  EditableDescription,
  NodeMetadataEditor,
  NODE_DESCRIPTION_TEXTAREA_MAX_PX,
  NODE_SHORT_DESCRIPTION_MAX_LENGTH,
} = await import('@/components/detail-panel');
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
    expect(findElement(tree, testIdEquals('detail-panel-description-editor'))).toBeNull();
  });

  // US-017: editor is a contentEditable div, not a textarea. The element is
  // uncontrolled — the source is seeded via useEffect+textContent on enter-
  // edit (not as a JSX value/children prop). Tests assert the editor's
  // wire-up (attributes, handlers, accessibility) and the textContent-based
  // commit path; the raw-markdown-visible side is exercised in the browser
  // verification because useEffect is shimmed to no-op in the test renderer.
  it('renders the contentEditable editor + save button in edit mode', () => {
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

    const editor = findElement(tree, testIdEquals('detail-panel-description-editor'));
    if (!editor) throw new Error('editor not found');
    // plaintext-only forces paste-as-text on Chromium/Safari; Firefox falls
    // back to the manual onPaste / onKeyDown Enter overrides below.
    expect(editor.props.contentEditable).toBe('plaintext-only');
    // Editor is uncontrolled — no value/children prop. Source seeding lives
    // in a useEffect that writes el.textContent imperatively.
    expect(editor.props.children).toBeUndefined();
    expect(typeof editor.props.onKeyDown).toBe('function');
    expect(typeof editor.props.onPaste).toBe('function');
    expect(typeof editor.props.onInput).toBe('function');
    expect(typeof editor.props.onBlur).toBe('function');
    // Accessibility: announced as a multiline textbox to screen readers so
    // the contentEditable feels like a textarea to AT users.
    expect(editor.props.role).toBe('textbox');
    expect(editor.props['aria-multiline']).toBe('true');
    expect(editor.props['aria-label']).toBe('Edit description');
    // Styling: inherits the panel's regular text size (NOT the textarea's
    // prior font-mono text-xs), with whitespace-pre-wrap so newlines render.
    const editorClass = editor.props.className as string;
    expect(editorClass).toContain('text-sm');
    expect(editorClass).toContain('whitespace-pre-wrap');
    expect(editorClass).toContain('pr-8'); // leave room for the save icon
    expect(editorClass).not.toContain('font-mono');

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
    // The editor is uncontrolled — `draft` mirrors textContent via onInput,
    // and commit reads `editorRef.current?.textContent ?? draft`. In the
    // hook-shim test environment, useRef returns { current: null }, so the
    // commit falls back to `draft`. Force draft='new body' via the
    // useStateOverrides slot to simulate a typed-in value.
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

  it('save commits the raw markdown source verbatim (no rendering)', () => {
    // US-017 AC: typing the literal string "**bold**" shows asterisks in the
    // editor and saves the asterisks verbatim — markdown is NOT rendered
    // until read mode (DescriptionMarkdown). With the editor uncontrolled,
    // `draft` mirrors textContent via onInput, so a draft value containing
    // literal markdown syntax round-trips through commit unmodified.
    const calls: Array<{ nodeId: string; value: string }> = [];
    const onSave = (nodeId: string, value: string) => calls.push({ nodeId, value });
    const rawMarkdown = '# Heading\n\n**bold** and *italic* with `code` and a [link](https://x).';
    const tree = renderWithHooks(
      () =>
        (EditableDescription as unknown as (p: Props) => unknown)({
          nodeId: 'n1',
          source: 'old',
          onSave,
        } as Props),
      [true, rawMarkdown],
    );
    const save = findElement(tree, testIdEquals('detail-panel-description-save'));
    if (!save) throw new Error('save button not found');
    (save.props.onClick as () => void)();
    expect(calls).toEqual([{ nodeId: 'n1', value: rawMarkdown }]);
  });

  it('onPaste strips clipboard formatting (Firefox plaintext-only fallback)', () => {
    // contentEditable='plaintext-only' is unsupported in Firefox — the
    // onPaste handler is our cross-browser guarantee: e.preventDefault()
    // followed by document.execCommand('insertText', false, plainText) lands
    // the clipboard as plain text in every browser. Verify the handler
    // calls preventDefault and pulls text/plain (not text/html) from
    // clipboardData. We mock execCommand so the test runs in Bun's no-DOM
    // environment.
    const tree = renderWithHooks(
      () =>
        (EditableDescription as unknown as (p: Props) => unknown)({
          nodeId: 'n1',
          source: 'old',
          onSave: () => {},
        } as Props),
      [true, 'draft'],
    );
    const editor = findElement(tree, testIdEquals('detail-panel-description-editor'));
    if (!editor) throw new Error('editor not found');
    const realExec = (
      globalThis as { document?: { execCommand?: (...args: unknown[]) => boolean } }
    ).document?.execCommand;
    const execCalls: Array<{ cmd: string; arg: unknown }> = [];
    (globalThis as { document?: unknown }).document = {
      ...((globalThis as { document?: object }).document ?? {}),
      execCommand: (cmd: string, _show: boolean, arg: unknown) => {
        execCalls.push({ cmd, arg });
        return true;
      },
    };
    let preventedDefault = false;
    const fakeEvent = {
      preventDefault: () => {
        preventedDefault = true;
      },
      clipboardData: {
        getData: (mime: string) => (mime === 'text/plain' ? 'pasted text' : ''),
      },
    };
    (editor.props.onPaste as (e: unknown) => void)(fakeEvent);
    expect(preventedDefault).toBe(true);
    expect(execCalls).toEqual([{ cmd: 'insertText', arg: 'pasted text' }]);
    // Restore.
    if (realExec) {
      (
        (globalThis as { document?: { execCommand?: unknown } }).document as {
          execCommand?: unknown;
        }
      ).execCommand = realExec;
    }
  });

  it('Escape in the editor cancels via onKeyDown (no commit, stops propagation)', () => {
    // The component's React onKeyDown handles Escape locally — preventDefault
    // (so the browser's native Escape doesn't reset the editor), stop
    // propagation on both the React-synthetic and native events (so canvas-
    // level Backspace/Delete handling doesn't react), and roll back to read
    // mode without firing onSave. Sheet-level Escape-to-close suppression is
    // layered separately via SheetContent's onEscapeKeyDown (see DetailPanel).
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
    const editor = findElement(tree, testIdEquals('detail-panel-description-editor'));
    if (!editor) throw new Error('editor not found');
    let preventedDefault = false;
    let stoppedPropagation = false;
    let stoppedNativePropagation = false;
    const fakeEvent = {
      key: 'Escape',
      preventDefault: () => {
        preventedDefault = true;
      },
      stopPropagation: () => {
        stoppedPropagation = true;
      },
      nativeEvent: {
        stopPropagation: () => {
          stoppedNativePropagation = true;
        },
      },
    };
    (editor.props.onKeyDown as (e: unknown) => void)(fakeEvent);
    expect(preventedDefault).toBe(true);
    expect(stoppedPropagation).toBe(true);
    expect(stoppedNativePropagation).toBe(true);
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
    const editor = findElement(tree, testIdEquals('detail-panel-description-editor'));
    if (!editor) throw new Error('editor not found');
    (editor.props.onBlur as () => void)();
    // Blur path on its own discards — no onSave invocation.
    expect(calls).toEqual([]);
  });
});

// US-011 (text-and-group-resize): NodeMetadataEditor renders the two free-text
// metadata controls (short description input + long description textarea) that
// edit `data.shortDescription` / `data.description` for every node variant.
// Both controls commit on blur via the callbacks; the textarea grows up to
// ~10 line-heights then scrolls; both inputs stop key events from bubbling
// to the canvas (so Backspace/Delete in the input never deletes the selected
// node).
describe('NodeMetadataEditor (US-011)', () => {
  type Props = Parameters<typeof NodeMetadataEditor>[0];
  const callEditor = (overrides: Partial<Props> = {}) => {
    const props: Props = {
      nodeId: 'n1',
      shortDescription: '',
      description: '',
      ...overrides,
    } as Props;
    return renderWithHooks(() => (NodeMetadataEditor as unknown as (p: Props) => unknown)(props));
  };

  it('renders both controls with the documented placeholders and aria-labels', () => {
    const tree = callEditor();
    const meta = findElement(tree, testIdEquals('detail-panel-metadata'));
    if (!meta) throw new Error('metadata block not found');

    const short = findElement(tree, testIdEquals('detail-panel-short-description'));
    if (!short) throw new Error('short description input not found');
    expect(short.props.type).toBe('text');
    expect(short.props.placeholder).toBe('One-line caption');
    expect(short.props['aria-label']).toBe('Short description');
    expect(short.props.maxLength).toBe(NODE_SHORT_DESCRIPTION_MAX_LENGTH);

    const long = findElement(tree, testIdEquals('detail-panel-description-meta'));
    if (!long) throw new Error('description textarea not found');
    expect(long.props.placeholder).toBe('Notes, context, anything…');
    expect(long.props['aria-label']).toBe('Description');
    // Textarea has a max-height cap that drives the auto-grow ceiling (~10
    // line-heights). Beyond it the user gets a scroll bar.
    const style = long.props.style as { maxHeight?: string };
    expect(style.maxHeight).toBe(`${NODE_DESCRIPTION_TEXTAREA_MAX_PX}px`);
  });

  it('seeds both controls from props (defaultValue equivalents via local state)', () => {
    const tree = callEditor({ shortDescription: 'hello short', description: 'hello long' });
    const short = findElement(tree, testIdEquals('detail-panel-short-description'));
    const long = findElement(tree, testIdEquals('detail-panel-description-meta'));
    if (!short || !long) throw new Error('inputs not found');
    expect(short.props.value).toBe('hello short');
    expect(long.props.value).toBe('hello long');
  });

  it('blur on short description input dispatches onShortDescriptionChange', () => {
    const calls: Array<{ id: string; value: string }> = [];
    const onShortDescriptionChange = (id: string, value: string) => calls.push({ id, value });
    const tree = callEditor({ onShortDescriptionChange });
    const short = findElement(tree, testIdEquals('detail-panel-short-description'));
    if (!short) throw new Error('short description input not found');
    (short.props.onBlur as (e: { target: { value: string } }) => void)({
      target: { value: 'A caption' },
    });
    expect(calls).toEqual([{ id: 'n1', value: 'A caption' }]);
  });

  it('blur on description textarea dispatches onMetaDescriptionChange', () => {
    const calls: Array<{ id: string; value: string }> = [];
    const onMetaDescriptionChange = (id: string, value: string) => calls.push({ id, value });
    const tree = callEditor({ onMetaDescriptionChange });
    const long = findElement(tree, testIdEquals('detail-panel-description-meta'));
    if (!long) throw new Error('description textarea not found');
    (long.props.onBlur as (e: { target: { value: string } }) => void)({
      target: { value: 'multi-line\nnotes here' },
    });
    expect(calls).toEqual([{ id: 'n1', value: 'multi-line\nnotes here' }]);
  });

  it('does not redispatch when the blur value equals the seeded prop value', () => {
    // Blurring without typing should be a no-op — otherwise every focus change
    // would create an undo entry with an identical value.
    const shortCalls: Array<{ id: string; value: string }> = [];
    const longCalls: Array<{ id: string; value: string }> = [];
    const onShortDescriptionChange = (id: string, value: string) => shortCalls.push({ id, value });
    const onMetaDescriptionChange = (id: string, value: string) => longCalls.push({ id, value });
    const tree = callEditor({
      shortDescription: 'unchanged',
      description: 'also unchanged',
      onShortDescriptionChange,
      onMetaDescriptionChange,
    });
    const short = findElement(tree, testIdEquals('detail-panel-short-description'));
    const long = findElement(tree, testIdEquals('detail-panel-description-meta'));
    if (!short || !long) throw new Error('inputs not found');
    (short.props.onBlur as (e: { target: { value: string } }) => void)({
      target: { value: 'unchanged' },
    });
    (long.props.onBlur as (e: { target: { value: string } }) => void)({
      target: { value: 'also unchanged' },
    });
    expect(shortCalls).toEqual([]);
    expect(longCalls).toEqual([]);
  });

  it('renders both controls read-only when no callbacks are wired (no PATCH plumbing)', () => {
    const tree = callEditor();
    const short = findElement(tree, testIdEquals('detail-panel-short-description'));
    const long = findElement(tree, testIdEquals('detail-panel-description-meta'));
    if (!short || !long) throw new Error('inputs not found');
    expect(short.props.readOnly).toBe(true);
    expect(long.props.readOnly).toBe(true);
  });

  it('stops keystrokes from bubbling to the canvas (Backspace would otherwise delete the node)', () => {
    const tree = callEditor({ onShortDescriptionChange: () => {} });
    const short = findElement(tree, testIdEquals('detail-panel-short-description'));
    if (!short) throw new Error('short description input not found');
    let stoppedReact = false;
    let stoppedNative = false;
    const e = {
      key: 'Backspace',
      stopPropagation: () => {
        stoppedReact = true;
      },
      nativeEvent: {
        stopPropagation: () => {
          stoppedNative = true;
        },
      },
    };
    (short.props.onKeyDown as (e: unknown) => void)(e);
    expect(stoppedReact).toBe(true);
    expect(stoppedNative).toBe(true);
  });
});

// US-011 (text-and-group-resize): the DetailPanel widens to open for every
// node variant (the pre-US-011 gate excluded image/icon/group). The metadata
// editor is the universal block; the play/state-only sections (EditableDescription,
// detail.fields, DynamicSection, RunSection, RecentEventsSection) remain gated.
describe('DetailPanel — metadata editor renders for every node variant (US-011)', () => {
  type PanelProps = Parameters<typeof DetailPanel>[0];
  const callPanel = (node: DemoNode) => {
    const props: PanelProps = {
      demoId: 'demo-1',
      node,
      connector: null,
      onClose: () => {},
    } as PanelProps;
    return renderWithHooks(() => (DetailPanel as unknown as (p: PanelProps) => unknown)(props));
  };

  const variants: DemoNode[] = [
    {
      id: 'p',
      type: 'playNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'p',
        kind: 'svc',
        stateSource: { kind: 'request' },
        playAction: { kind: 'http', method: 'GET', url: '/p' },
      },
    },
    {
      id: 's',
      type: 'stateNode',
      position: { x: 0, y: 0 },
      data: { label: 's', kind: 'svc', stateSource: { kind: 'event' } },
    },
    {
      id: 'sh',
      type: 'shapeNode',
      position: { x: 0, y: 0 },
      data: { shape: 'rectangle' },
    },
    {
      id: 'im',
      type: 'imageNode',
      position: { x: 0, y: 0 },
      data: { image: 'data:image/png;base64,AA' },
    },
    {
      id: 'ic',
      type: 'iconNode',
      position: { x: 0, y: 0 },
      data: { icon: 'shopping-cart' },
    },
    {
      id: 'g',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { label: 'g' },
    },
  ];

  for (const node of variants) {
    it(`renders the NodeMetadataEditor when a ${node.type} is selected`, () => {
      // NodeMetadataEditor is captured as a placeholder by the hook-shim — its
      // body doesn't execute, so we match it by component identity, not by
      // a nested data-testid that would live inside the un-executed body.
      const tree = callPanel(node);
      const editor = findElement(tree, (el) => el.type === (NodeMetadataEditor as unknown));
      expect(editor).not.toBeNull();
    });
  }

  it('forwards shortDescription / description prop values into the metadata editor', () => {
    const node: DemoNode = {
      id: 'sh',
      type: 'shapeNode',
      position: { x: 0, y: 0 },
      data: {
        shape: 'rectangle',
        shortDescription: 'a one-liner',
        description: 'multi\nlines',
      },
    };
    const tree = callPanel(node);
    const editor = findElement(tree, (el) => el.type === (NodeMetadataEditor as unknown));
    if (!editor) throw new Error('metadata editor placeholder not found');
    expect(editor.props.nodeId).toBe('sh');
    expect(editor.props.shortDescription).toBe('a one-liner');
    expect(editor.props.description).toBe('multi\nlines');
  });

  it('forwards both metadata change callbacks into the editor placeholder', () => {
    const node: DemoNode = {
      id: 'sh',
      type: 'shapeNode',
      position: { x: 0, y: 0 },
      data: { shape: 'rectangle' },
    };
    const onShortDescriptionChange = () => {};
    const onMetaDescriptionChange = () => {};
    const props = {
      demoId: 'demo-1',
      node,
      connector: null,
      onClose: () => {},
      onShortDescriptionChange,
      onMetaDescriptionChange,
    };
    const tree = renderWithHooks(() =>
      (DetailPanel as unknown as (p: typeof props) => unknown)(props),
    );
    const editor = findElement(tree, (el) => el.type === (NodeMetadataEditor as unknown));
    if (!editor) throw new Error('metadata editor placeholder not found');
    expect(editor.props.onShortDescriptionChange).toBe(onShortDescriptionChange);
    expect(editor.props.onMetaDescriptionChange).toBe(onMetaDescriptionChange);
  });

  it('still gates EditableDescription / detail.fields behind play/state node types', () => {
    // Shape / image / icon / group don't carry `data.detail` — the legacy
    // EditableDescription block (driven by detail.summary/detail.description)
    // must not render for them. The new NodeMetadataEditor is the universal
    // surface.
    const shape: DemoNode = {
      id: 'sh',
      type: 'shapeNode',
      position: { x: 0, y: 0 },
      data: { shape: 'rectangle' },
    };
    const tree = callPanel(shape);
    expect(findElement(tree, testIdEquals('detail-panel-description-block'))).toBeNull();
    // detail-panel-description is the read-mode markdown wrapper; also absent.
    expect(findElement(tree, testIdEquals('detail-panel-description'))).toBeNull();
  });
});

// US-013 (text-and-group-resize): the side panel exposes a Label input for
// group nodes only. Typing in the input dispatches the same callback the
// inline label editor uses (group-node.tsx → onCommit → onNodeLabelChange in
// demo-view.tsx), so panel + inline edits share the existing
// `node:<id>:label` coalesce key.
describe('NodeMetadataEditor — Label row (US-013)', () => {
  type Props = Parameters<typeof NodeMetadataEditor>[0];
  const callEditor = (overrides: Partial<Props> = {}) => {
    const props: Props = {
      nodeId: 'g1',
      shortDescription: '',
      description: '',
      ...overrides,
    } as Props;
    return renderWithHooks(() => (NodeMetadataEditor as unknown as (p: Props) => unknown)(props));
  };

  it('omits the Label input entirely when label prop is undefined (non-group nodes)', () => {
    const tree = callEditor({ shortDescription: '', description: '' });
    expect(findElement(tree, testIdEquals('detail-panel-label'))).toBeNull();
  });

  it('renders the Label input when label prop is a defined string (even empty)', () => {
    const tree = callEditor({ label: '' });
    const labelInput = findElement(tree, testIdEquals('detail-panel-label'));
    if (!labelInput) throw new Error('label input not found');
    expect(labelInput.props.type).toBe('text');
    expect(labelInput.props['aria-label']).toBe('Label');
    expect(labelInput.props.placeholder).toBe('Group label');
    expect(labelInput.props.value).toBe('');
  });

  it('seeds the Label input from the label prop', () => {
    const tree = callEditor({ label: 'Stage 1' });
    const labelInput = findElement(tree, testIdEquals('detail-panel-label'));
    if (!labelInput) throw new Error('label input not found');
    expect(labelInput.props.value).toBe('Stage 1');
  });

  it('is read-only when onLabelChange is not wired', () => {
    const tree = callEditor({ label: 'Stage 1' });
    const labelInput = findElement(tree, testIdEquals('detail-panel-label'));
    if (!labelInput) throw new Error('label input not found');
    expect(labelInput.props.readOnly).toBe(true);
  });

  it('is editable (readOnly=false) when onLabelChange is wired', () => {
    const tree = callEditor({ label: '', onLabelChange: () => {} });
    const labelInput = findElement(tree, testIdEquals('detail-panel-label'));
    if (!labelInput) throw new Error('label input not found');
    expect(labelInput.props.readOnly).toBe(false);
  });

  it('blur dispatches onLabelChange(nodeId, value) when the value changed', () => {
    const calls: Array<{ id: string; value: string }> = [];
    const onLabelChange = (id: string, value: string) => calls.push({ id, value });
    const tree = callEditor({ label: 'Old', onLabelChange });
    const labelInput = findElement(tree, testIdEquals('detail-panel-label'));
    if (!labelInput) throw new Error('label input not found');
    (labelInput.props.onBlur as (e: { target: { value: string } }) => void)({
      target: { value: 'New label' },
    });
    expect(calls).toEqual([{ id: 'g1', value: 'New label' }]);
  });

  it('does not redispatch when the blur value equals the seeded label', () => {
    // Focusing then blurring the input without typing must not create an undo
    // entry — otherwise every selection change would push an identical entry
    // onto the stack.
    const calls: Array<{ id: string; value: string }> = [];
    const onLabelChange = (id: string, value: string) => calls.push({ id, value });
    const tree = callEditor({ label: 'Stable', onLabelChange });
    const labelInput = findElement(tree, testIdEquals('detail-panel-label'));
    if (!labelInput) throw new Error('label input not found');
    (labelInput.props.onBlur as (e: { target: { value: string } }) => void)({
      target: { value: 'Stable' },
    });
    expect(calls).toEqual([]);
  });

  it('empty-string blur (cleared label) dispatches as "" (parity with inline editor clear)', () => {
    // The inline editor in group-node.tsx commits an empty string when the
    // user clears the field; demo-view's onNodeLabelChange treats `""` as the
    // canonical "no label" sentinel (the disk PATCH path strips it on merge).
    // The panel must mirror that — clearing the input + blur should dispatch
    // ('', not undefined) so the two paths share semantics.
    const calls: Array<{ id: string; value: string }> = [];
    const onLabelChange = (id: string, value: string) => calls.push({ id, value });
    const tree = callEditor({ label: 'Old', onLabelChange });
    const labelInput = findElement(tree, testIdEquals('detail-panel-label'));
    if (!labelInput) throw new Error('label input not found');
    (labelInput.props.onBlur as (e: { target: { value: string } }) => void)({
      target: { value: '' },
    });
    expect(calls).toEqual([{ id: 'g1', value: '' }]);
  });

  it('stops keystrokes from bubbling to the canvas (Backspace would otherwise delete the node)', () => {
    const tree = callEditor({ label: 'Stage 1', onLabelChange: () => {} });
    const labelInput = findElement(tree, testIdEquals('detail-panel-label'));
    if (!labelInput) throw new Error('label input not found');
    let stoppedReact = false;
    let stoppedNative = false;
    const e = {
      key: 'Backspace',
      stopPropagation: () => {
        stoppedReact = true;
      },
      nativeEvent: {
        stopPropagation: () => {
          stoppedNative = true;
        },
      },
    };
    (labelInput.props.onKeyDown as (e: unknown) => void)(e);
    expect(stoppedReact).toBe(true);
    expect(stoppedNative).toBe(true);
  });
});

// US-013: DetailPanel-level wiring — for a selected group, the Label row
// is forwarded to NodeMetadataEditor; for any other node variant the
// `label` / `onLabelChange` props on the editor placeholder stay undefined
// so the row collapses.
describe('DetailPanel — Label input is gated to group nodes (US-013)', () => {
  type PanelProps = Parameters<typeof DetailPanel>[0];

  it('forwards label + onLabelChange into the editor when a group is selected', () => {
    const onLabelChange = () => {};
    const node: DemoNode = {
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { label: 'Stage 1' },
    };
    const props: PanelProps = {
      demoId: 'demo-1',
      node,
      connector: null,
      onLabelChange,
      onClose: () => {},
    } as PanelProps;
    const tree = renderWithHooks(() =>
      (DetailPanel as unknown as (p: PanelProps) => unknown)(props),
    );
    const editor = findElement(tree, (el) => el.type === (NodeMetadataEditor as unknown));
    if (!editor) throw new Error('metadata editor placeholder not found');
    expect(editor.props.label).toBe('Stage 1');
    expect(editor.props.onLabelChange).toBe(onLabelChange);
  });

  it('seeds the label as "" when the group has no label set', () => {
    const node: DemoNode = {
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      data: {},
    };
    const props: PanelProps = {
      demoId: 'demo-1',
      node,
      connector: null,
      onLabelChange: () => {},
      onClose: () => {},
    } as PanelProps;
    const tree = renderWithHooks(() =>
      (DetailPanel as unknown as (p: PanelProps) => unknown)(props),
    );
    const editor = findElement(tree, (el) => el.type === (NodeMetadataEditor as unknown));
    if (!editor) throw new Error('metadata editor placeholder not found');
    expect(editor.props.label).toBe('');
  });

  it('does not forward label or onLabelChange when a non-group node is selected', () => {
    // The on-disk shape's `data.label` exists for play/state/shape/icon too,
    // but the side-panel Label control is scoped to groups (the AC names
    // groups specifically; other variants edit labels via inline-on-node /
    // StyleStrip). Verify the editor placeholder gets `label: undefined` and
    // `onLabelChange: undefined` for those variants.
    const nonGroup: DemoNode = {
      id: 'sh',
      type: 'shapeNode',
      position: { x: 0, y: 0 },
      data: { shape: 'rectangle', label: 'Has a label' },
    };
    const props: PanelProps = {
      demoId: 'demo-1',
      node: nonGroup,
      connector: null,
      onLabelChange: () => {},
      onClose: () => {},
    } as PanelProps;
    const tree = renderWithHooks(() =>
      (DetailPanel as unknown as (p: PanelProps) => unknown)(props),
    );
    const editor = findElement(tree, (el) => el.type === (NodeMetadataEditor as unknown));
    if (!editor) throw new Error('metadata editor placeholder not found');
    expect(editor.props.label).toBeUndefined();
    expect(editor.props.onLabelChange).toBeUndefined();
  });

  it('shares the exact `onLabelChange` function reference between panel + inline editor wiring (one coalesce key)', () => {
    // The coalesce contract is: panel-side blur and inline-editor commit BOTH
    // route through the SAME function (demo-view.tsx::onNodeLabelChange),
    // which uses coalesceKey `node:<id>:label`. Verify the panel passes the
    // exact prop reference through to the editor placeholder — any wrapper or
    // adapter here would break the coalesce by changing the call shape.
    const onNodeLabelChange = () => {};
    const node: DemoNode = {
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { label: 'Group' },
    };
    const props: PanelProps = {
      demoId: 'demo-1',
      node,
      connector: null,
      onLabelChange: onNodeLabelChange,
      onClose: () => {},
    } as PanelProps;
    const tree = renderWithHooks(() =>
      (DetailPanel as unknown as (p: PanelProps) => unknown)(props),
    );
    const editor = findElement(tree, (el) => el.type === (NodeMetadataEditor as unknown));
    if (!editor) throw new Error('metadata editor placeholder not found');
    // Identity check — not just `toBeDefined()`. The same function reference
    // is what the canvas hands to group-node.tsx as `onLabelChange` on the
    // node data (verified in demo-canvas.tsx wiring tests).
    expect(editor.props.onLabelChange).toBe(onNodeLabelChange);
  });
});
