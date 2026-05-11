import { describe, expect, it } from 'bun:test';
import { InlineEdit } from '@/components/inline-edit';
import { ShapeNode } from '@/components/nodes/shape-node';
import { SHAPE_CLASS, shapeChromeClass, shapeChromeStyle } from '@/components/nodes/shape-node';
import { COLOR_TOKENS } from '@/lib/color-tokens';
import { Handle, type NodeProps } from '@xyflow/react';
import * as React from 'react';

// US-009: the drag-create ghost in demo-canvas.tsx (`canvas-draw-ghost`) MUST
// render with the same chrome as the committed node so the preview is
// WYSIWYG. The ghost reuses these helpers verbatim, so any drift between the
// helper output and the committed node would break the contract — these tests
// pin both halves to the documented values.
describe('shape-node chrome helpers', () => {
  describe('shapeChromeClass', () => {
    it('returns the documented Tailwind chrome string for each shape', () => {
      expect(shapeChromeClass('rectangle')).toBe(SHAPE_CLASS.rectangle);
      expect(shapeChromeClass('ellipse')).toBe(SHAPE_CLASS.ellipse);
      expect(shapeChromeClass('sticky')).toBe(SHAPE_CLASS.sticky);
      expect(shapeChromeClass('text')).toBe(SHAPE_CLASS.text);
    });

    it('keeps sticky-specific tilt + shadow in the class so the ghost matches the placed sticky', () => {
      // The ghost is the only consumer outside ShapeNode that reads this
      // class; if a future change removes the tilt the ghost drops it too,
      // and the WYSIWYG promise breaks unless this test is updated.
      expect(SHAPE_CLASS.sticky).toContain('-rotate-1');
      expect(SHAPE_CLASS.sticky).toContain('shadow-md');
    });
  });

  describe('shapeChromeStyle', () => {
    it('rectangle/ellipse default to theme border + transparent background (no override)', () => {
      const rect = shapeChromeStyle('rectangle');
      expect(rect.borderColor).toBe(COLOR_TOKENS.default.border);
      expect(rect.backgroundColor).toBeUndefined();
      expect(rect.borderWidth).toBeUndefined();
      expect(rect.borderRadius).toBeUndefined();

      const ellipse = shapeChromeStyle('ellipse');
      expect(ellipse.borderColor).toBe(COLOR_TOKENS.default.border);
      expect(ellipse.backgroundColor).toBeUndefined();
    });

    it('sticky defaults to the amber palette (border + background) so the ghost previews yellow, not primary', () => {
      const sticky = shapeChromeStyle('sticky');
      expect(sticky.borderColor).toBe(COLOR_TOKENS.default.border);
      expect(sticky.backgroundColor).toBe(COLOR_TOKENS.amber.background);
    });

    it('text returns an empty style — chromeless on commit', () => {
      // The ghost compensates with a faint dashed outline (added in
      // demo-canvas.tsx); the placed text node still has no chrome.
      expect(shapeChromeStyle('text')).toEqual({});
    });

    it('honours explicit author overrides for color, border size/style, and corner radius', () => {
      const styled = shapeChromeStyle('rectangle', {
        borderColor: 'blue',
        backgroundColor: 'green',
        borderSize: 5,
        borderStyle: 'dashed',
        cornerRadius: 12,
      });
      expect(styled.borderColor).toBe(COLOR_TOKENS.blue.border);
      expect(styled.backgroundColor).toBe(COLOR_TOKENS.green.background);
      expect(styled.borderWidth).toBe(5);
      expect(styled.borderStyle).toBe('dashed');
      expect(styled.borderRadius).toBe(12);
    });

    it('ignores cornerRadius for ellipse (rounded-full owns the shape)', () => {
      const ellipse = shapeChromeStyle('ellipse', { cornerRadius: 20 });
      expect(ellipse.borderRadius).toBeUndefined();
    });

    it('ignores cornerRadius for text (no border to round)', () => {
      const text = shapeChromeStyle('text', { cornerRadius: 8 });
      expect(text).toEqual({});
    });
  });
});

// US-003: text shapes are chromeless annotations with NO connect handles —
// they can't be wired into the flow. The render-based assertions below mirror
// the hook-shim pattern from icon-node.test.tsx (no DOM, no React Flow
// store): we shim React's internal dispatcher, call the memoized impl as a
// function, and walk the returned tree to assert handle presence/absence and
// inline-edit-on-mount behavior.
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

function callShapeNode(data: Record<string, unknown>, overrides: Partial<NodeProps> = {}): unknown {
  const props = {
    id: 's1',
    type: 'shapeNode',
    data: { label: 'Hello', ...data },
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
  // ShapeNode is memo(ShapeNodeImpl, …) — the inner impl lives at `.type` per
  // React's memo descriptor shape; call it directly so the hook shim drives
  // the rendered tree.
  const impl = (ShapeNode as unknown as { type: (p: NodeProps) => unknown }).type;
  return renderWithHooks(() => impl(props));
}

describe('ShapeNode connect handles', () => {
  it('rectangle shape renders all four <Handle> elements', () => {
    const tree = callShapeNode({ shape: 'rectangle' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('ellipse shape renders all four <Handle> elements', () => {
    const tree = callShapeNode({ shape: 'ellipse' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('sticky shape renders all four <Handle> elements', () => {
    const tree = callShapeNode({ shape: 'sticky' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('text shape renders ZERO <Handle> elements (US-003: chromeless annotation)', () => {
    const tree = callShapeNode({ shape: 'text' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(0);
  });

  it('selected text shape still renders ZERO <Handle> elements (no opacity flip path)', () => {
    // The chromed shapes flip handles to opacity:1 on selection. Text has no
    // handles at all, selected or not — pin the invariant so a future refactor
    // that re-introduces a `selected ? <Handle/> : null` branch breaks here.
    const tree = callShapeNode({ shape: 'text' }, { selected: true } as Partial<NodeProps>);
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(0);
  });
});

describe('ShapeNode autoEditOnMount (US-003 + US-015)', () => {
  it('text shape with autoEditOnMount mounts directly into InlineEdit (focus claimed on mount)', () => {
    // US-015 already mounts shape nodes directly into label-edit when
    // autoEditOnMount is true; US-003's AC pins this for text specifically so
    // a freshly created text annotation accepts typing immediately. The
    // InlineEdit useEffect calls el.focus() + selectAll on mount (see
    // inline-edit.tsx) — its presence in the tree IS the focus-claim
    // assertion in this hook-shim renderer.
    const tree = callShapeNode({
      shape: 'text',
      autoEditOnMount: true,
      onLabelChange: () => {},
    });
    const inlineEdits = findAll(tree, (el) => el.type === InlineEdit);
    expect(inlineEdits).toHaveLength(1);
  });

  it('text shape WITHOUT autoEditOnMount does NOT mount into InlineEdit', () => {
    const tree = callShapeNode({
      shape: 'text',
      onLabelChange: () => {},
    });
    const inlineEdits = findAll(tree, (el) => el.type === InlineEdit);
    expect(inlineEdits).toHaveLength(0);
  });
});
