import { describe, expect, it } from 'bun:test';
import { PlayNode } from '@/components/nodes/play-node';
import { Button } from '@/components/ui/button';
import type { NodeProps } from '@xyflow/react';
import * as React from 'react';

// Mirrors the hook-shim pattern from icon-node.test.tsx — no DOM, no React
// Flow store; we walk the returned element tree to find the play button and
// assert on its className. Documented in detail in icon-node.test.tsx.
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

function callPlayNode(data: Record<string, unknown>, overrides: Partial<NodeProps> = {}): unknown {
  const props = {
    id: 'p1',
    type: 'playNode',
    data: {
      label: 'Run',
      kind: 'http',
      ...data,
    },
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
  const impl = (PlayNode as unknown as { type: (p: NodeProps) => unknown }).type;
  return renderWithHooks(() => impl(props));
}

function findPlayButton(tree: unknown): ReactElementLike {
  const el = findElement(
    tree,
    (el) =>
      el.type === Button &&
      (el.props as { 'data-testid'?: string })['data-testid'] === 'play-button',
  );
  if (!el) throw new Error('play-button not found');
  return el;
}

describe('PlayNode play button (US-021 hover affordance)', () => {
  it('emerald hover/focus-visible classes are present on the play button', () => {
    const tree = callPlayNode({ playAction: { kind: 'http' }, onPlay: () => {} });
    const button = findPlayButton(tree);
    const className = String((button.props as { className?: string }).className ?? '');
    expect(className).toContain('hover:bg-emerald-500');
    expect(className).toContain('hover:text-white');
    expect(className).toContain('focus-visible:bg-emerald-500');
    expect(className).toContain('focus-visible:text-white');
    expect(className).toContain('dark:hover:bg-emerald-400');
    expect(className).toContain('dark:focus-visible:bg-emerald-400');
  });

  it('keeps the circular shape + size classes alongside the new hover styles', () => {
    const tree = callPlayNode({ playAction: { kind: 'http' }, onPlay: () => {} });
    const button = findPlayButton(tree);
    const className = String((button.props as { className?: string }).className ?? '');
    // The hover styling must NOT have replaced the circle chrome.
    expect(className).toContain('h-8');
    expect(className).toContain('w-8');
    expect(className).toContain('rounded-full');
  });

  it('error state keeps both the rose border AND the emerald hover classes', () => {
    const tree = callPlayNode({
      playAction: { kind: 'http' },
      onPlay: () => {},
      status: 'error',
      errorMessage: 'boom',
    });
    const button = findPlayButton(tree);
    const className = String((button.props as { className?: string }).className ?? '');
    // Rose border for the error indication.
    expect(className).toContain('border-rose-500');
    expect(className).toContain('dark:border-rose-400');
    // Emerald hover still applies — user is going to retry; the green
    // affordance should still color-code the click target.
    expect(className).toContain('hover:bg-emerald-500');
    expect(className).toContain('hover:text-white');
  });

  it('disabled state (no action wired) — the Button base class blocks pointer events, hover styles are inert', () => {
    // Without an action OR onPlay handler the button receives `disabled={true}`;
    // the base Button class chain has `disabled:pointer-events-none`, so the
    // hover styles never fire even though the className still contains them.
    // This test asserts the disabled prop reaches the Button, which is what
    // makes the disabled rule work — not the absence of hover classes.
    const tree = callPlayNode({});
    const button = findPlayButton(tree);
    const disabled = (button.props as { disabled?: boolean }).disabled;
    expect(disabled).toBe(true);
  });

  it('running state — the button is disabled while running so hover styles are inert', () => {
    const tree = callPlayNode({
      playAction: { kind: 'http' },
      onPlay: () => {},
      status: 'running',
    });
    const button = findPlayButton(tree);
    const disabled = (button.props as { disabled?: boolean }).disabled;
    expect(disabled).toBe(true);
  });
});
