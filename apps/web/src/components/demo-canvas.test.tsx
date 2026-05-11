import { describe, expect, it } from 'bun:test';
import { DemoCanvas, type DemoCanvasProps } from '@/components/demo-canvas';
import { ReactFlow } from '@xyflow/react';
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

function callDemoCanvas(overrides: Partial<DemoCanvasProps> = {}): unknown {
  const props: DemoCanvasProps = {
    nodes: [],
    connectors: [],
    selectedNodeIds: [],
    selectedConnectorIds: [],
    ...overrides,
  };
  return renderWithHooks(() => (DemoCanvas as unknown as (p: DemoCanvasProps) => unknown)(props));
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
});
