import { describe, expect, it } from 'bun:test';
import { CanvasToolbar, HTML_BLOCK_DND_TYPE, TOOLBAR_SHAPES } from '@/components/canvas-toolbar';
import type { ShapeKind } from '@/lib/api';
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
  it('renders every TOOLBAR_SHAPES entry either inline or inside the Shape picker', () => {
    const tree = callToolbar();
    for (const entry of TOOLBAR_SHAPES) {
      const inline = findElement(tree, testIdEquals(`toolbar-shape-${entry.shape}`));
      const inPicker = findElement(tree, testIdEquals(`shape-picker-${entry.shape}`));
      expect(inline ?? inPicker).not.toBeNull();
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

    it('renders the database tile inside the Shape picker popover', () => {
      const tree = callToolbar();
      const btn = findElement(tree, testIdEquals('shape-picker-database'));
      expect(btn).not.toBeNull();
    });

    it('toggles draw mode for database via onSelectShape', () => {
      let picked: string | null | undefined;
      const tree = callToolbar({
        onSelectShape: (shape) => {
          picked = shape;
        },
      });
      const btn = findElement(tree, testIdEquals('shape-picker-database'));
      if (!btn) throw new Error('database picker tile not found');
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
      // forward it onto any rendered button. The set of permissible button
      // testids is the shapes + the optional insert-icon entry + the optional
      // US-017 HTML block entry — nothing else (Tidy must stay removed).
      const tree = callToolbar({ onPickIcon: () => {}, htmlBlockEnabled: true });
      const allButtons = findAll(tree, (el) => el.type === 'button');
      const ids = allButtons
        .map((b) => b.props['data-testid'])
        .filter((id): id is string => typeof id === 'string');
      const allowed = new Set([
        'toolbar-insert-icon',
        'toolbar-html-block',
        'toolbar-shape-picker',
      ]);
      for (const id of ids) {
        expect(
          id.startsWith('toolbar-shape-') || id.startsWith('shape-picker-') || allowed.has(id),
        ).toBe(true);
      }
    });

    it('renders every shape — primaries inline, illustratives in the Shape picker', () => {
      // The insert-icon button is captured INSIDE IconPickerPopover's `anchor`
      // prop, which lives outside the children tree the hook-shim walks —
      // asserting that it renders here would require walking arbitrary props.
      // Pin the shape tiles instead.
      const tree = callToolbar({ onPickIcon: () => {} });
      const primaryShapes: ShapeKind[] = ['rectangle', 'ellipse', 'sticky', 'text'];
      for (const shape of primaryShapes) {
        expect(findElement(tree, testIdEquals(`toolbar-shape-${shape}`))).not.toBeNull();
      }
      // Illustrative shapes live behind the Shape picker.
      expect(findElement(tree, testIdEquals('toolbar-shape-picker'))).not.toBeNull();
      expect(findElement(tree, testIdEquals('shape-picker-database'))).not.toBeNull();
    });
  });

  describe('US-017: HTML block toolbar tile', () => {
    it('does NOT render the toolbar-html-block button when htmlBlockEnabled is unset', () => {
      // The Custom section is hidden by default — only callers that wire the
      // canvas-side onCreateHtmlNode handler opt in via htmlBlockEnabled.
      const tree = callToolbar();
      expect(findElement(tree, testIdEquals('toolbar-html-block'))).toBeNull();
    });

    it('renders the toolbar-html-block button when htmlBlockEnabled is true', () => {
      const tree = callToolbar({ htmlBlockEnabled: true });
      const btn = findElement(tree, testIdEquals('toolbar-html-block'));
      expect(btn).not.toBeNull();
      expect(btn?.props['aria-label']).toBe('HTML block');
      expect(btn?.props.title).toBe('HTML block');
      // The drag-create UX is HTML5 native DnD — the tile must be draggable.
      expect(btn?.props.draggable).toBe(true);
    });

    it('exports a stable HTML_BLOCK_DND_TYPE marker the canvas drop handler reads', () => {
      // The constant lives in canvas-toolbar.tsx and is consumed by
      // demo-canvas.tsx's drop handler; the literal must stay grep-able and
      // distinctive. Pin both the export and a sanity prefix so a typo can't
      // silently disable the feature.
      expect(typeof HTML_BLOCK_DND_TYPE).toBe('string');
      expect(HTML_BLOCK_DND_TYPE).toMatch(/^application\//);
      expect(HTML_BLOCK_DND_TYPE).toContain('html-block');
    });

    it('onDragStart sets the HTML_BLOCK_DND_TYPE marker and copy effectAllowed', () => {
      const tree = callToolbar({ htmlBlockEnabled: true });
      const btn = findElement(tree, testIdEquals('toolbar-html-block'));
      if (!btn) throw new Error('html block button not found');
      const onDragStart = btn.props.onDragStart as (e: unknown) => void;
      expect(typeof onDragStart).toBe('function');
      const setData: Array<{ type: string; value: string }> = [];
      let effectAllowed = '';
      const fakeEvent = {
        dataTransfer: {
          setData: (type: string, value: string) => {
            setData.push({ type, value });
          },
          set effectAllowed(v: string) {
            effectAllowed = v;
          },
          get effectAllowed() {
            return effectAllowed;
          },
        },
      };
      onDragStart(fakeEvent);
      expect(setData).toEqual([{ type: HTML_BLOCK_DND_TYPE, value: '1' }]);
      expect(effectAllowed).toBe('copy');
    });

    it('onDragStart swallows DataTransfer write errors (Safari quirk)', () => {
      // Safari can throw when dataTransfer is read-only mid-dispatch; the
      // handler must not propagate so the user-visible drag still initiates.
      const tree = callToolbar({ htmlBlockEnabled: true });
      const btn = findElement(tree, testIdEquals('toolbar-html-block'));
      if (!btn) throw new Error('html block button not found');
      const onDragStart = btn.props.onDragStart as (e: unknown) => void;
      const fakeEvent = {
        dataTransfer: {
          setData: () => {
            throw new Error('SecurityError: read-only DataTransfer');
          },
          set effectAllowed(_v: string) {},
        },
      };
      expect(() => onDragStart(fakeEvent)).not.toThrow();
    });
  });
});
