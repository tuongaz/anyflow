import { beforeEach, describe, expect, it } from 'bun:test';
import type { DemoNode } from '@/lib/api';
import * as React from 'react';

// The DetailPanel root reads localStorage on first render
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

const mockWindow = {
  localStorage: mockLocalStorage,
  addEventListener: () => {},
  removeEventListener: () => {},
};
(globalThis as unknown as { window: typeof mockWindow }).window = mockWindow;

const { DetailPanel, EditableField } = await import('@/components/detail-panel');

// Same dispatcher-shim trick used by icon-node.test.tsx — apps/web tests run
// without a DOM, so we shim React's internal hook dispatcher and call the
// component as a function. The returned tree is the first render with
// sub-components (Sheet/SheetContent) captured as placeholders.
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

function findByTestId(tree: unknown, testId: string): ReactElementLike | null {
  const matches = findAll(
    tree,
    (el) => el.props['data-testid'] === testId || el.props.testIdBase === testId,
  );
  return matches[0] ?? null;
}

function makePlayNode(overrides: Partial<DemoNode> = {}): DemoNode {
  return {
    id: 'n1',
    type: 'playNode',
    position: { x: 0, y: 0 },
    data: {
      name: 'A play node',
      kind: 'service',
      stateSource: { kind: 'request' },
      description: 'Short body text',
      detail: 'Long-form notes',
      ...((overrides as { data?: object }).data ?? {}),
    },
    ...overrides,
  } as DemoNode;
}

beforeEach(() => {
  memStore.clear();
});

describe('EditableField', () => {
  it('renders read-only text when no onSave callback is provided', () => {
    const tree = renderWithHooks(() =>
      EditableField({
        nodeId: 'n1',
        value: 'hello',
        placeholder: 'placeholder',
        multiline: false,
        ariaLabel: 'Field',
        testIdBase: 'field',
      }),
    );
    // Read-only renders a plain div with text and no edit button.
    expect(isElement(tree)).toBe(true);
    if (!isElement(tree)) return;
    expect(tree.type).toBe('div');
    expect(tree.props.children).toBe('hello');
  });

  it('renders a clickable button surface (no pencil icon) when editable', () => {
    const tree = renderWithHooks(() =>
      EditableField({
        nodeId: 'n1',
        value: 'hello',
        placeholder: 'placeholder',
        multiline: false,
        ariaLabel: 'Field',
        testIdBase: 'field',
        onSave: () => {},
      }),
    );
    // Default (non-editing) view: a single <button> wrapping the text. No
    // Pencil/Check icons should exist anywhere in the subtree.
    const buttons = findAll(tree, (el) => el.type === 'button');
    expect(buttons.length).toBe(1);
    expect(buttons[0]?.props.children).toBe('hello');
    // No SVG icon children — the rendered text is the click target.
    const svgs = findAll(tree, (el) => el.type === 'svg');
    expect(svgs.length).toBe(0);
  });

  it('renders a contentEditable div when in edit mode (useState[0] = true)', () => {
    const tree = renderWithHooks(
      () =>
        EditableField({
          nodeId: 'n1',
          value: 'hello',
          placeholder: 'p',
          multiline: true,
          ariaLabel: 'Detail',
          testIdBase: 'detail',
          onSave: () => {},
        }),
      // First useState in EditableField is `isEditing`. Force it to true.
      [true],
    );
    const editor = findByTestId(tree, 'detail-editor');
    expect(editor).not.toBeNull();
    expect(editor?.props.contentEditable).toBe('plaintext-only');
    expect(editor?.props['aria-multiline']).toBe('true');
    // Save/check button must NOT be present — blur commits.
    const saveBtn = findByTestId(tree, 'detail-save');
    expect(saveBtn).toBeNull();
  });

  it('shows placeholder text when value is empty', () => {
    const tree = renderWithHooks(() =>
      EditableField({
        nodeId: 'n1',
        value: '',
        placeholder: 'Add notes',
        multiline: true,
        ariaLabel: 'Detail',
        testIdBase: 'detail',
        onSave: () => {},
      }),
    );
    const buttons = findAll(tree, (el) => el.type === 'button');
    expect(buttons[0]?.props.children).toBe('Add notes');
  });
});

describe('DetailPanel', () => {
  it('renders three EditableField slots (name, description, detail) for a node', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: makePlayNode(),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onDescriptionChange: () => {},
        onDetailChange: () => {},
      }),
    );
    // Each editable field gets a wrapper with data-testid.
    expect(findByTestId(tree, 'detail-panel-name')).not.toBeNull();
    expect(findByTestId(tree, 'detail-panel-description')).not.toBeNull();
    expect(findByTestId(tree, 'detail-panel-detail')).not.toBeNull();
  });

  it('shows no editor-input chrome at rest (no pencil/check icons anywhere)', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: makePlayNode(),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onDescriptionChange: () => {},
        onDetailChange: () => {},
      }),
    );
    // Any svg elements would be icon affordances. The three editable fields
    // are pencil-free, the HtmlNodeSection (htmlNode-only) is not rendered
    // for this playNode, so the tree should have zero svg children.
    const svgs = findAll(tree, (el) => el.type === 'svg');
    expect(svgs.length).toBe(0);
  });

  it('omits onSave callbacks → fields render read-only (no <button>)', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: makePlayNode(),
        connector: null,
        onClose: () => {},
        // No onNameChange/onDescriptionChange/onDetailChange — read-only.
      }),
    );
    const buttons = findAll(tree, (el) => el.type === 'button');
    expect(buttons.length).toBe(0);
  });

  it('renders only the ConnectorSummary for a connector (no editable fields)', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: null,
        connector: {
          id: 'c1',
          source: 'a',
          target: 'b',
          kind: 'default',
          label: 'links',
        },
        onClose: () => {},
      }),
    );
    expect(findByTestId(tree, 'detail-panel-name')).toBeNull();
    expect(findByTestId(tree, 'detail-panel-description')).toBeNull();
    expect(findByTestId(tree, 'detail-panel-detail')).toBeNull();
  });
});
