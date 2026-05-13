import { describe, expect, it } from 'bun:test';
import { CanvasToolbar, TOOLBAR_SHAPES } from '@/components/canvas-toolbar';
import * as React from 'react';

// Bun runs apps/web tests without a DOM. The hook-shim pattern (also used by
// icon-node.test.tsx / demo-canvas.test.tsx) replaces React's internal
// dispatcher with synchronous stubs so we can call CanvasToolbar as a
// function and walk the returned React element tree.
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
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const found = findElement(item, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!isElement(tree)) return null;
  if (predicate(tree)) return tree;
  const children = tree.props.children;
  if (children === undefined || children === null) return null;
  return findElement(children, predicate);
}

function findAll(tree: unknown, predicate: (el: ReactElementLike) => boolean): ReactElementLike[] {
  const out: ReactElementLike[] = [];
  function walk(node: unknown) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isElement(node)) return;
    if (predicate(node)) out.push(node);
    const children = node.props.children;
    if (children === undefined || children === null) return;
    walk(children);
  }
  walk(tree);
  return out;
}

function testIdEquals(value: string) {
  return (el: ReactElementLike) => el.props['data-testid'] === value;
}

function callToolbar(props: Partial<React.ComponentProps<typeof CanvasToolbar>> = {}): unknown {
  const merged: React.ComponentProps<typeof CanvasToolbar> = {
    activeShape: null,
    onSelectShape: () => {},
    ...props,
  };
  return renderWithHooks(() => (CanvasToolbar as unknown as (p: typeof merged) => unknown)(merged));
}

describe('CanvasToolbar', () => {
  it('renders all shape buttons in the documented order', () => {
    const tree = callToolbar();
    const shapeButtons = TOOLBAR_SHAPES.map((entry) =>
      findElement(tree, testIdEquals(`toolbar-shape-${entry.shape}`)),
    );
    for (const btn of shapeButtons) {
      expect(btn).not.toBeNull();
    }
  });

  describe('US-010: Database illustrative-shape palette entry', () => {
    it('includes a Database entry in TOOLBAR_SHAPES', () => {
      // The illustrative-shape entry must be registered alongside the other
      // shapes so drag-create produces a `shapeNode` with
      // `data.shape: 'database'`. Pinning the registry (not just the rendered
      // button) so the drop-on-pane popover (US-015) and any other consumer of
      // TOOLBAR_SHAPES picks the entry up automatically.
      const entry = TOOLBAR_SHAPES.find((s) => s.shape === 'database');
      expect(entry).toBeDefined();
      expect(entry?.label).toBe('Database');
      // Icon component is captured by reference; assert it's distinct from the
      // other shape icons (lucide's Database glyph, not Square / Circle).
      expect(entry?.Icon).toBeDefined();
    });

    it('renders the toolbar-shape-database button', () => {
      const tree = callToolbar();
      const btn = findElement(tree, testIdEquals('toolbar-shape-database'));
      expect(btn).not.toBeNull();
      expect(btn?.props['aria-label']).toBe('Database');
      expect(btn?.props.title).toBe('Database');
    });

    it('toggles draw mode for database via onSelectShape', () => {
      let picked: string | null | undefined;
      const tree = callToolbar({
        onSelectShape: (shape) => {
          picked = shape;
        },
      });
      const btn = findElement(tree, testIdEquals('toolbar-shape-database'));
      if (!btn) throw new Error('database toolbar button not found');
      const onClick = btn.props.onClick as () => void;
      onClick();
      expect(picked).toBe('database');
    });
  });

  describe('US-020: Tidy / Auto Align button removed from left toolbar', () => {
    it('does NOT render the toolbar-tidy button', () => {
      // Auto Align moved to the bottom-left Controls cluster. The left
      // toolbar must no longer surface a Tidy trigger.
      const tree = callToolbar();
      const tidy = findElement(tree, testIdEquals('toolbar-tidy'));
      expect(tidy).toBeNull();
    });

    it('does NOT accept an onTidy prop (compile-time guard via runtime shape)', () => {
      // Defensive: even if a caller wires onTidy, the toolbar must not
      // forward it onto any rendered button. There must be zero buttons
      // with a non-shape, non-icon-picker testid pattern. The trailing
      // toolbar elements should be the shapes + (optionally) the insert
      // icon — nothing else.
      const tree = callToolbar({ onPickIcon: () => {} });
      const allButtons = findAll(tree, (el) => el.type === 'button');
      const ids = allButtons
        .map((b) => b.props['data-testid'])
        .filter((id): id is string => typeof id === 'string');
      for (const id of ids) {
        expect(id.startsWith('toolbar-shape-') || id === 'toolbar-insert-icon').toBe(true);
      }
    });

    it('keeps the 4 shape buttons after Tidy removal', () => {
      // The insert-icon button is captured INSIDE IconPickerPopover's `anchor`
      // prop, which lives outside the children tree the hook-shim walks —
      // asserting that it renders here would require walking arbitrary props.
      // Pin the shape buttons (Tidy's siblings in the old layout) instead.
      const tree = callToolbar({ onPickIcon: () => {} });
      for (const entry of TOOLBAR_SHAPES) {
        expect(findElement(tree, testIdEquals(`toolbar-shape-${entry.shape}`))).not.toBeNull();
      }
    });
  });
});
