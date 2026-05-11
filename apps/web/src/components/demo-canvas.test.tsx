import { describe, expect, it } from 'bun:test';
import { DemoCanvas, type DemoCanvasProps } from '@/components/demo-canvas';
import type { DemoNode } from '@/lib/api';
import { type Node, ReactFlow } from '@xyflow/react';
import * as React from 'react';

// Bun runs apps/web tests without a DOM. The hook-shim pattern (also used by
// icon-node.test.tsx / icon-picker-popover.test.tsx) replaces React's internal
// dispatcher with synchronous stubs so we can call DemoCanvas as a function
// and walk the returned React element tree. Sub-components — ReactFlow,
// Background, Controls, StoreApiBridge, CanvasToolbar etc. — are captured as
// `{ type, props }` placeholders without executing their render bodies, so
// xyflow's zustand-provider requirement never trips.
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
 * `refSink`, when provided, receives each useRef in declaration order so the
 * test can mutate ref.current to drive handlers that read from refs.
 */
function renderWithHooks<T>(
  fn: () => T,
  options: {
    useStateOverrides?: ReadonlyArray<unknown>;
    refSink?: { current: unknown }[];
  } = {},
): T {
  const { useStateOverrides, refSink } = options;
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
    useRef: <T,>(initial: T) => {
      const ref = { current: initial };
      refSink?.push(ref as { current: unknown });
      return ref;
    },
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

function callDemoCanvas(
  overrides: Partial<DemoCanvasProps> = {},
  hookOptions: {
    useStateOverrides?: ReadonlyArray<unknown>;
    refSink?: { current: unknown }[];
  } = {},
): unknown {
  const props: DemoCanvasProps = {
    nodes: [],
    connectors: [],
    selectedNodeIds: [],
    selectedConnectorIds: [],
    ...overrides,
  };
  return renderWithHooks(
    () => (DemoCanvas as unknown as (p: DemoCanvasProps) => unknown)(props),
    hookOptions,
  );
}

function makeShapeNode(id: string): DemoNode {
  return {
    id,
    type: 'shapeNode',
    position: { x: 0, y: 0 },
    data: { label: id, shape: 'rectangle' },
  };
}

describe('DemoCanvas', () => {
  it('wires selectNodesOnDrag={false} on the ReactFlow root', () => {
    // US-018: dragging an unselected node moves it without auto-selecting
    // (and therefore without opening the detail panel). React Flow defaults
    // this to true; the explicit false on the JSX is the only switch.
    const tree = callDemoCanvas();
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
    expect(rf.props.selectNodesOnDrag).toBe(false);
  });

  describe('US-025: only the selected node may originate a new connection', () => {
    it('unselected nodes receive connectable: false on the rfNode payload', () => {
      // Per xyflow's NodeWrapper:
      //   isConnectable = !!(node.connectable || (nodesConnectable && typeof node.connectable === 'undefined'))
      // Setting node.connectable=false makes the unselected node's handles
      // ignore connection-start gestures regardless of the global
      // nodesConnectable, so onConnectStart never fires from those handles.
      const tree = callDemoCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
        selectedNodeIds: [],
        onCreateConnector: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      const rfNodes = rf.props.nodes as Node[];
      const a = rfNodes.find((n) => n.id === 'a');
      const b = rfNodes.find((n) => n.id === 'b');
      expect(a?.connectable).toBe(false);
      expect(b?.connectable).toBe(false);
    });

    it('selected node has connectable left undefined so the global nodesConnectable gate still applies', () => {
      // Leaving node.connectable undefined defers to the ReactFlow root's
      // nodesConnectable, which we wire to !!onCreateConnector && !drawShape.
      // This keeps read-only and draw-mode gating consistent on the selected
      // node without redundantly recomputing it per node.
      const tree = callDemoCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
        selectedNodeIds: ['a'],
        onCreateConnector: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      const rfNodes = rf.props.nodes as Node[];
      const a = rfNodes.find((n) => n.id === 'a');
      const b = rfNodes.find((n) => n.id === 'b');
      expect(a?.connectable).toBeUndefined();
      expect(b?.connectable).toBe(false);
    });

    it('connecting BETWEEN two unselected nodes is impossible (both gated false)', () => {
      // Confirms the PRD's "Connecting BETWEEN two unselected nodes is now
      // impossible" — both sides of the canvas are gated off until one is
      // explicitly selected by the user.
      const tree = callDemoCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b'), makeShapeNode('c')],
        selectedNodeIds: ['c'],
        onCreateConnector: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      const rfNodes = rf.props.nodes as Node[];
      expect(rfNodes.find((n) => n.id === 'a')?.connectable).toBe(false);
      expect(rfNodes.find((n) => n.id === 'b')?.connectable).toBe(false);
      expect(rfNodes.find((n) => n.id === 'c')?.connectable).toBeUndefined();
    });
  });

  describe('US-016: drag-to-create new shape gesture', () => {
    // The ReactFlow draw-mode props end up identical to the pre-marquee
    // (pre-US-010) values when `drawShape` is set: selectionOnDrag=false,
    // panOnDrag=false, nodesDraggable=false, elementsSelectable=false. These
    // four props together leave the empty pane inert for xyflow's own pointer
    // listeners so our wrapper-level pointerdown→move→up handlers own the
    // gesture. If any of these regresses, the gesture stops landing in our
    // handlers and drag-to-create silently breaks.
    it('disables xyflow gesture handling on the empty pane when in draw mode', () => {
      // drawShape is the FIRST useState slot in demo-canvas.tsx (line 637 in
      // current file). Forcing it to 'rectangle' simulates the user picking a
      // shape from the toolbar.
      const tree = callDemoCanvas({}, { useStateOverrides: [/* drawShape */ 'rectangle'] });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      expect(rf.props.selectionOnDrag).toBe(false);
      expect(rf.props.panOnDrag).toBe(false);
      expect(rf.props.nodesDraggable).toBe(false);
      expect(rf.props.elementsSelectable).toBe(false);
    });

    // Index-coupled ref capture so the test can pre-set drawShapeRef /
    // rfInstanceRef and observe drawing/start/current refs after the gesture.
    // Indices correspond to useRef() call order in demo-canvas.tsx — if a new
    // useRef is added above any of these, the indices shift and this test
    // fails loudly with a clear "ref index drifted" assertion below.
    const REF = {
      wrapper: 0,
      rfInstance: 1,
      drawShape: 10,
      drawStart: 11,
      drawCurrent: 12,
      drawing: 13,
    } as const;

    // Bracket access on a sparse array returns `T | undefined`; this asserts
    // the index is in-bounds (the test's drift-detection check above already
    // verified that) and narrows for the assertions below.
    const refAt = (refs: { current: unknown }[], i: number): { current: unknown } => {
      const r = refs[i];
      if (!r) throw new Error(`ref index ${i} out of bounds (length=${refs.length})`);
      return r;
    };

    it('pointerdown → move → up on the pane commits via onCreateShapeNode with the dragged size', () => {
      const refs: { current: unknown }[] = [];
      const captured: Array<{
        shape: string;
        pos: { x: number; y: number };
        size: { width: number; height: number };
      }> = [];
      const onCreateShapeNode = (
        shape: string,
        pos: { x: number; y: number },
        size: { width: number; height: number },
      ) => {
        captured.push({ shape, pos, size });
      };
      const tree = callDemoCanvas(
        { onCreateShapeNode },
        {
          // drawShape is the FIRST useState slot in demo-canvas.tsx — must
          // be set so the JSX-level wrapperCursor and ReactFlow props enter
          // draw mode. The gesture itself reads drawShapeRef (a separate
          // ref slot we mutate below) since the handler doesn't depend on
          // the state value directly.
          useStateOverrides: [/* drawShape */ 'rectangle'],
          refSink: refs,
        },
      );

      // Sanity-check ref indices haven't drifted. The drawShape ref typing
      // accepts string|null so it starts as null; we identify it by the
      // useRef call order. A drift here means the gesture handlers in
      // production would read the WRONG ref and the test would either pass
      // spuriously or fail in a confusing way.
      expect(refs.length).toBeGreaterThanOrEqual(REF.drawing + 1);
      expect(refAt(refs, REF.drawShape).current).toBeNull();
      expect(refAt(refs, REF.drawStart).current).toBeNull();
      expect(refAt(refs, REF.drawCurrent).current).toBeNull();
      expect(refAt(refs, REF.drawing).current).toBe(false);
      expect(refAt(refs, REF.rfInstance).current).toBeNull();

      // Pre-populate the refs the handlers depend on: drawShape must be the
      // user-selected shape (the production code's useEffect sets this from
      // the drawShape state, but the hook-shim no-ops useEffect), and
      // rfInstance must expose screenToFlowPosition so onPointerUp can
      // convert client → flow coords on commit. Identity mapping keeps the
      // assertion math obvious.
      refAt(refs, REF.drawShape).current = 'rectangle';
      refAt(refs, REF.rfInstance).current = {
        screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      };

      // Walk the tree to the wrapper div (the same element that carries the
      // onPointerDown / onPointerMove / onPointerUp props in the JSX).
      // `data-testid="anydemo-canvas"` is the wrapper's testid.
      const wrapper = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'anydemo-canvas',
      );
      if (!wrapper) throw new Error('wrapper div not found in DemoCanvas tree');

      const onPointerDown = wrapper.props.onPointerDown as (e: unknown) => void;
      const onPointerMove = wrapper.props.onPointerMove as (e: unknown) => void;
      const onPointerUp = wrapper.props.onPointerUp as (e: unknown) => void;
      expect(typeof onPointerDown).toBe('function');
      expect(typeof onPointerMove).toBe('function');
      expect(typeof onPointerUp).toBe('function');

      // Synthetic pointer events. `target.classList.contains('react-flow__pane')`
      // gates the handler — give the fake target a real DOMTokenList-ish
      // contains method. `currentTarget` provides setPointerCapture /
      // releasePointerCapture stubs (the production code try/catch-wraps both
      // since synthetic events throw on the real DOM methods).
      const paneTarget = {
        classList: { contains: (c: string) => c === 'react-flow__pane' },
      };
      const noop = () => {};
      const makeEvent = (clientX: number, clientY: number) => ({
        target: paneTarget,
        currentTarget: { setPointerCapture: noop, releasePointerCapture: noop },
        clientX,
        clientY,
        pointerId: 1,
        button: 0,
        isPrimary: true,
        preventDefault: noop,
        stopPropagation: noop,
      });

      onPointerDown(makeEvent(300, 200));
      // After down: drawing flips true, start + current populated.
      expect(refAt(refs, REF.drawing).current).toBe(true);
      expect(refAt(refs, REF.drawStart).current).toEqual({ x: 300, y: 200 });
      expect(refAt(refs, REF.drawCurrent).current).toEqual({ x: 300, y: 200 });

      onPointerMove(makeEvent(500, 350));
      // After move: current advances, start stays.
      expect(refAt(refs, REF.drawCurrent).current).toEqual({ x: 500, y: 350 });
      expect(refAt(refs, REF.drawStart).current).toEqual({ x: 300, y: 200 });

      onPointerUp(makeEvent(500, 350));
      // After up: drawing flips back to false, exitDrawMode clears refs.
      expect(refAt(refs, REF.drawing).current).toBe(false);

      // The crucial assertion: onCreateShapeNode fired with the right shape,
      // the flowPosition of the drag's min corner, and a size matching the
      // drag's flow-space bbox (the screenToFlowPosition stub is identity, so
      // flow = screen for this test).
      expect(captured.length).toBe(1);
      const commit = captured[0];
      if (!commit) throw new Error('onCreateShapeNode was not called');
      expect(commit.shape).toBe('rectangle');
      expect(commit.pos).toEqual({ x: 300, y: 200 });
      expect(commit.size).toEqual({ width: 200, height: 150 });
    });

    it('single-click (no drag past MIN_DRAW_SIZE=40px) commits a default-sized shape', () => {
      const refs: { current: unknown }[] = [];
      const captured: Array<{
        shape: string;
        pos: { x: number; y: number };
        size: { width: number; height: number };
      }> = [];
      const tree = callDemoCanvas(
        {
          onCreateShapeNode: (shape, pos, size) => {
            captured.push({
              shape: shape as string,
              pos: pos as { x: number; y: number },
              size: size as { width: number; height: number },
            });
          },
        },
        {
          useStateOverrides: [/* drawShape */ 'ellipse'],
          refSink: refs,
        },
      );
      refAt(refs, REF.drawShape).current = 'ellipse';
      refAt(refs, REF.rfInstance).current = {
        screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      };

      const wrapper = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'anydemo-canvas',
      );
      if (!wrapper) throw new Error('wrapper div not found');

      const paneTarget = {
        classList: { contains: (c: string) => c === 'react-flow__pane' },
      };
      const noop = () => {};
      const at = (x: number, y: number) => ({
        target: paneTarget,
        currentTarget: { setPointerCapture: noop, releasePointerCapture: noop },
        clientX: x,
        clientY: y,
        pointerId: 1,
        button: 0,
        isPrimary: true,
        preventDefault: noop,
        stopPropagation: noop,
      });

      // Same position for down and up — zero-pixel drag → falls back to the
      // shape's default size (ellipse: 200 × 120).
      (wrapper.props.onPointerDown as (e: unknown) => void)(at(400, 300));
      (wrapper.props.onPointerUp as (e: unknown) => void)(at(400, 300));

      expect(captured.length).toBe(1);
      const commit = captured[0];
      if (!commit) throw new Error('onCreateShapeNode was not called');
      expect(commit.shape).toBe('ellipse');
      expect(commit.pos).toEqual({ x: 400, y: 300 });
      expect(commit.size).toEqual({ width: 200, height: 120 });
    });

    it('pointerdown without drawShape set is a no-op (gesture only runs in draw mode)', () => {
      const refs: { current: unknown }[] = [];
      const captured: unknown[] = [];
      const tree = callDemoCanvas(
        { onCreateShapeNode: (...args: unknown[]) => captured.push(args) },
        { refSink: refs },
      );
      // drawShape state defaults to null and drawShapeRef.current stays null
      // (no useEffect to copy state → ref under the hook shim, matching the
      // production handler's read).
      const wrapper = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'anydemo-canvas',
      );
      if (!wrapper) throw new Error('wrapper div not found');
      const paneTarget = {
        classList: { contains: (c: string) => c === 'react-flow__pane' },
      };
      const noop = () => {};
      const evt = {
        target: paneTarget,
        currentTarget: { setPointerCapture: noop, releasePointerCapture: noop },
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        button: 0,
        isPrimary: true,
        preventDefault: noop,
        stopPropagation: noop,
      };
      (wrapper.props.onPointerDown as (e: unknown) => void)(evt);
      // drawing ref stays false because the handler early-returns when
      // drawShapeRef.current is null.
      expect(refAt(refs, REF.drawing).current).toBe(false);
      (wrapper.props.onPointerUp as (e: unknown) => void)(evt);
      expect(captured.length).toBe(0);
    });
  });
});
