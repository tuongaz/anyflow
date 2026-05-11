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

function makeGroupNode(id: string): DemoNode {
  return {
    id,
    type: 'group',
    position: { x: 0, y: 0 },
    data: { width: 200, height: 200 },
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

  it('wires nodeClickDistance > 0 so jitter during click still selects', () => {
    // Regression: xyflow defaults nodeClickDistance to 0, which combined with
    // selectNodesOnDrag={false} makes ANY sub-pixel pointer jitter between
    // mousedown and mouseup register as a drag (no selection) instead of a
    // click. Symptom: clicking a node often does nothing on the first try.
    // The explicit positive value gives the user click-tolerance.
    const tree = callDemoCanvas();
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
    expect(rf.props.nodeClickDistance).toBeGreaterThan(0);
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
      // US-018 added editHandlesRef (slot 3, after storeApiRef) so every
      // draw-* ref shifted down by one. The group enter/exit feature added
      // `activeGroupIdRef` (slot 3, after storeApiRef) too, shifting all
      // later refs down by another slot. Update this map alongside any
      // future useRef addition above drawShape.
      drawShape: 12,
      drawStart: 13,
      drawCurrent: 14,
      drawing: 15,
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

  describe('US-012: right-click context menu Group item visibility', () => {
    // After a marquee selects multiple nodes, the right-click context menu
    // must offer a "Group" action — this is the only path users have to wrap
    // a selection into a group node. The Group item renders only when
    // `groupableCount >= 2 && ungroupableCount === 0 && onGroupNodes`. Each
    // condition has bitten us:
    //   • groupableCount: filters out already-parented nodes and group nodes
    //   • ungroupableCount: blocks Group when a group is in the selection
    //     (Ungroup takes over)
    //   • onGroupNodes: parent must wire the callback (gated on demoId)
    const findByTestId = (tree: unknown, id: string) =>
      findElement(tree, (el) => (el.props as { 'data-testid'?: unknown })['data-testid'] === id);

    it('renders the Group item when ≥ 2 free nodes are selected', () => {
      const tree = callDemoCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
        selectedNodeIds: ['a', 'b'],
        onGroupNodes: () => {},
      });
      expect(findByTestId(tree, 'node-context-menu-group')).not.toBeNull();
    });

    it('hides the Group item when only 1 node is selected', () => {
      const tree = callDemoCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
        selectedNodeIds: ['a'],
        onGroupNodes: () => {},
      });
      expect(findByTestId(tree, 'node-context-menu-group')).toBeNull();
    });

    it('hides Group and shows Ungroup when a group is in the selection', () => {
      const tree = callDemoCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b'), makeGroupNode('g')],
        selectedNodeIds: ['a', 'b', 'g'],
        onGroupNodes: () => {},
        onUngroupSelection: () => {},
      });
      expect(findByTestId(tree, 'node-context-menu-group')).toBeNull();
      expect(findByTestId(tree, 'node-context-menu-ungroup')).not.toBeNull();
    });

    it('counts only free nodes — already-parented ids are filtered out', () => {
      // Two selected nodes, but one is parented to a group already. That
      // leaves a single groupable node — Group must not render.
      const child: DemoNode = {
        ...makeShapeNode('a'),
        parentId: 'g',
      };
      const tree = callDemoCanvas({
        nodes: [child, makeShapeNode('b'), makeGroupNode('g')],
        selectedNodeIds: ['a', 'b'],
        onGroupNodes: () => {},
      });
      expect(findByTestId(tree, 'node-context-menu-group')).toBeNull();
    });

    it('handleGroupPick forwards selectedNodeIds to onGroupNodes', () => {
      // Closure over the selection prop — the handler that fires when the
      // user clicks the Group menu item must pass the current selection ids
      // (a snapshot copy) to the parent's group op.
      const captured: string[][] = [];
      const tree = callDemoCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b'), makeShapeNode('c')],
        selectedNodeIds: ['a', 'b', 'c'],
        onGroupNodes: (ids) => {
          captured.push([...ids]);
        },
      });
      const item = findByTestId(tree, 'node-context-menu-group');
      if (!item) throw new Error('Group item missing');
      const onSelect = item.props.onSelect as (() => void) | undefined;
      if (!onSelect) throw new Error('Group item has no onSelect');
      onSelect();
      expect(captured).toEqual([['a', 'b', 'c']]);
    });
  });

  describe('group enter/exit: double-click required to control children', () => {
    // The group-enter feature: children of a group are gated until the user
    // double-clicks the group to "enter" it. Each rule below corresponds to
    // one bullet in the PRD:
    //   • child of an inactive group → selectable: false, draggable: false
    //   • child of the ACTIVE group → no extra gating
    //   • dbl-click on a group → activeGroupId state updated → children unlock
    //   • single-click on a gated child → click is redirected to the parent
    //     group's id (onSelectionChange + onNodeClick both fire with parent)
    //   • pane click → activeGroupId cleared
    //   • edge between two children of an inactive group → selectable: false
    function childOf(id: string, parentId: string): DemoNode {
      const base = makeShapeNode(id);
      return { ...base, parentId };
    }

    it('children of an inactive group are non-selectable and non-draggable', () => {
      const tree = callDemoCanvas({
        nodes: [makeGroupNode('g'), childOf('a', 'g'), childOf('b', 'g')],
        selectedNodeIds: [],
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      const rfNodes = rf.props.nodes as Node[];
      const a = rfNodes.find((n) => n.id === 'a');
      const b = rfNodes.find((n) => n.id === 'b');
      const g = rfNodes.find((n) => n.id === 'g');
      expect(a?.selectable).toBe(false);
      expect(a?.draggable).toBe(false);
      expect(b?.selectable).toBe(false);
      expect(b?.draggable).toBe(false);
      // The group itself is not gated — it's the entry point.
      expect(g?.selectable).toBeUndefined();
      expect(g?.draggable).toBeUndefined();
    });

    it('child has its label/description edit callbacks stripped while gated', () => {
      // Without this strip, a user could bypass the "double-click first"
      // requirement by double-clicking a child's body to enter inline label
      // edit — the child renderers wire onDoubleClick to setIsEditing(true)
      // when data.onLabelChange is present.
      const tree = callDemoCanvas({
        nodes: [makeGroupNode('g'), childOf('a', 'g')],
        selectedNodeIds: [],
        onNodeLabelChange: () => {},
        onNodeDescriptionChange: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      const rfNodes = rf.props.nodes as Node[];
      const a = rfNodes.find((n) => n.id === 'a');
      const data = a?.data as Record<string, unknown> | undefined;
      expect(data?.onLabelChange).toBeUndefined();
      expect(data?.onDescriptionChange).toBeUndefined();
    });

    it('marks the active group with data.isActive so the chrome can re-style', () => {
      // activeGroupId is the FIRST `useState<string | null>` in DemoCanvas
      // (declared right after `drawShape`). Force-set it to the group id so
      // the buildNode path treats this group as entered.
      const tree = callDemoCanvas(
        {
          nodes: [makeGroupNode('g'), childOf('a', 'g')],
          selectedNodeIds: [],
          onNodeLabelChange: () => {},
        },
        { useStateOverrides: [/* drawShape */ undefined, /* activeGroupId */ 'g'] },
      );
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      const rfNodes = rf.props.nodes as Node[];
      const g = rfNodes.find((n) => n.id === 'g');
      const a = rfNodes.find((n) => n.id === 'a');
      expect((g?.data as { isActive?: boolean }).isActive).toBe(true);
      // And the gating is lifted on the active group's children: they now
      // get back the label-edit callback and are selectable + draggable.
      expect(a?.selectable).toBeUndefined();
      expect(a?.draggable).toBeUndefined();
      expect((a?.data as { onLabelChange?: unknown }).onLabelChange).toBeDefined();
    });

    it('onNodeDoubleClick on a group is wired (enters the group)', () => {
      // We can't observe the state update through the hook shim, but we can
      // verify that the wired handler delegates to the group case: calling
      // it with a non-group node should NOT throw, and the wiring exists.
      const tree = callDemoCanvas({
        nodes: [makeGroupNode('g'), childOf('a', 'g')],
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      const onNodeDoubleClick = rf.props.onNodeDoubleClick as
        | ((e: unknown, node: { id: string; type?: string }) => void)
        | undefined;
      expect(onNodeDoubleClick).toBeDefined();
      // Should accept group and non-group nodes without throwing.
      onNodeDoubleClick?.({}, { id: 'g', type: 'group' });
      onNodeDoubleClick?.({}, { id: 'a', type: 'shapeNode' });
    });

    it('clicking a gated child redirects the click to the parent group', () => {
      // The redirect feeds both onSelectionChange and onNodeClick with the
      // parent group's id, so the detail panel + selection ring both land on
      // the group (matching the outcome of clicking the group's border).
      const selChanges: Array<[string[], string[]]> = [];
      const clicks: string[] = [];
      const tree = callDemoCanvas({
        nodes: [makeGroupNode('g'), childOf('a', 'g')],
        selectedNodeIds: [],
        onSelectionChange: (ns, cs) => selChanges.push([[...ns], [...cs]]),
        onNodeClick: (id) => clicks.push(id),
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      const onNodeClick = rf.props.onNodeClick as (e: unknown, node: Node) => void;
      onNodeClick({}, { id: 'a', type: 'shapeNode', position: { x: 0, y: 0 }, data: {} } as Node);
      expect(selChanges).toEqual([[['g'], []]]);
      expect(clicks).toEqual(['g']);
    });

    it('clicking a non-descendant node while a group is active exits the group', () => {
      // When activeGroupId is 'g' and the user clicks a node OUTSIDE the
      // group (no parentId or a different parent), the click should still
      // forward to onNodeClick — and the activeGroupId state should be
      // cleared (we can't observe state, but the click MUST forward to the
      // user's callback so the detail panel opens for the clicked node).
      const clicks: string[] = [];
      const tree = callDemoCanvas(
        {
          nodes: [makeGroupNode('g'), childOf('a', 'g'), makeShapeNode('outside')],
          onNodeClick: (id) => clicks.push(id),
        },
        { useStateOverrides: [/* drawShape */ undefined, /* activeGroupId */ 'g'] },
      );
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      const onNodeClick = rf.props.onNodeClick as (e: unknown, node: Node) => void;
      onNodeClick({}, {
        id: 'outside',
        type: 'shapeNode',
        position: { x: 0, y: 0 },
        data: {},
      } as Node);
      expect(clicks).toEqual(['outside']);
    });

    it('pane click forwards onPaneClick (and clears the active group)', () => {
      // The state clear isn't observable through the hook shim, but the
      // wrapped handler MUST forward to the parent's onPaneClick so the
      // detail panel closes — that's the contract callers rely on.
      const paneClicks: number[] = [];
      const tree = callDemoCanvas({
        nodes: [makeGroupNode('g'), childOf('a', 'g')],
        onPaneClick: () => paneClicks.push(1),
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      const onPaneClick = rf.props.onPaneClick as (e: unknown) => void;
      onPaneClick({});
      expect(paneClicks).toEqual([1]);
    });

    it('edge between two children of an inactive group is non-selectable', () => {
      // Both endpoints inside the same gated group → the edge is dropped
      // from the selectable set. handleEdgeClickWithGroupGate (below) routes
      // a click on that edge to the parent group instead.
      const tree = callDemoCanvas({
        nodes: [makeGroupNode('g'), childOf('a', 'g'), childOf('b', 'g')],
        connectors: [{ id: 'e1', source: 'a', target: 'b', kind: 'default' }],
        selectedNodeIds: [],
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      const rfEdges = rf.props.edges as Array<{ id: string; selectable?: boolean }>;
      const e1 = rfEdges.find((e) => e.id === 'e1');
      expect(e1?.selectable).toBe(false);
    });

    it('clicking a gated edge redirects to selecting the parent group', () => {
      const selChanges: Array<[string[], string[]]> = [];
      const clicks: string[] = [];
      const tree = callDemoCanvas({
        nodes: [makeGroupNode('g'), childOf('a', 'g'), childOf('b', 'g')],
        connectors: [{ id: 'e1', source: 'a', target: 'b', kind: 'default' }],
        selectedNodeIds: [],
        onSelectionChange: (ns, cs) => selChanges.push([[...ns], [...cs]]),
        onConnectorClick: (id) => clicks.push(`conn:${id}`),
        onNodeClick: (id) => clicks.push(`node:${id}`),
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in DemoCanvas tree');
      const onEdgeClick = rf.props.onEdgeClick as (
        e: unknown,
        edge: { id: string; source: string; target: string },
      ) => void;
      onEdgeClick({}, { id: 'e1', source: 'a', target: 'b' });
      expect(selChanges).toEqual([[['g'], []]]);
      // The redirect surfaces the click on the parent group (a node), not
      // on the connector — onConnectorClick should NOT fire for a gated edge.
      expect(clicks).toEqual(['node:g']);
    });
  });
});
