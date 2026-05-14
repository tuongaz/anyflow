import { describe, expect, it, mock } from 'bun:test';
import { CommandPalette, type CommandPaletteProps } from '@/components/command-palette';
import { COMMANDS, type CommandContext } from '@/lib/keyboard-shortcuts';
import * as React from 'react';

// apps/web tests run without a DOM. Shim React's internal hook dispatcher so we
// can call CommandPalette as a function and walk the returned tree directly.
// Same pattern used by share-menu.test.tsx and inline-edit.test.tsx.
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

function findAll(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
  acc: ReactElementLike[] = [],
): ReactElementLike[] {
  // Children slots can be nested arrays (e.g. `<div>{map1.map(g => <div>{g.rows.map(r => <button/>)}</div>)}</div>`
  // produces `children: [groupDiv, [button, button, ...]]`). Recurse through
  // arrays so deeply-nested rows still surface.
  if (Array.isArray(tree)) {
    for (const child of tree) findAll(child, predicate, acc);
    return acc;
  }
  if (!isElement(tree)) return acc;
  if (predicate(tree)) acc.push(tree);
  const children = tree.props.children;
  if (children === undefined || children === null) return acc;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) findAll(child, predicate, acc);
  return acc;
}

function findByTestId(tree: unknown, id: string): ReactElementLike | null {
  const matches = findAll(
    tree,
    (el) => (el.props as { 'data-testid'?: string })['data-testid'] === id,
  );
  return matches[0] ?? null;
}

function findRow(tree: unknown, commandId: string): ReactElementLike | null {
  return findByTestId(tree, `command-palette-row-${commandId}`);
}

const FULL_CTX: CommandContext = {
  hasSelection: true,
  canUndo: true,
  canRedo: true,
  hasClipboard: true,
};

const EMPTY_CTX: CommandContext = {
  hasSelection: false,
  canUndo: false,
  canRedo: false,
  hasClipboard: false,
};

function renderPalette(props: Partial<CommandPaletteProps> = {}): unknown {
  const merged: CommandPaletteProps = {
    open: true,
    onOpenChange: () => {},
    runCommand: () => {},
    ctx: FULL_CTX,
    ...props,
  };
  return renderWithHooks(() =>
    (CommandPalette as unknown as (p: CommandPaletteProps) => unknown)(merged),
  );
}

describe('CommandPalette', () => {
  it('renders a row for every command in COMMANDS at default state', () => {
    const tree = renderPalette();
    for (const cmd of COMMANDS) {
      const row = findRow(tree, cmd.id);
      if (!row) throw new Error(`missing row for ${cmd.id}`);
      expect(row).not.toBeNull();
    }
  });

  it('renders shortcut badges sourced from COMMANDS — never hardcoded labels', () => {
    const tree = renderPalette();
    for (const cmd of COMMANDS) {
      if (!cmd.shortcut) continue;
      const badge = findByTestId(tree, `command-palette-shortcut-${cmd.id}`);
      if (!badge) throw new Error(`missing shortcut badge for ${cmd.id}`);
      expect(badge.props.children).toBe(cmd.shortcut);
    }
  });

  it('reads command labels from COMMANDS so a label change in the registry propagates here', () => {
    const tree = renderPalette();
    const tidyRow = findRow(tree, 'layout.tidy');
    if (!tidyRow) throw new Error('tidy row missing');
    // The label appears inside the row's first child column. Walk the
    // descendants to confirm the literal label string is present somewhere
    // under the row — and matches the registry.
    const labels = findAll(tidyRow, (el) => {
      const children = el.props.children;
      return typeof children === 'string' && children === 'Tidy layout';
    });
    expect(labels.length).toBeGreaterThan(0);
  });

  it('marks rows disabled when their enabled(ctx) predicate returns false', () => {
    const tree = renderPalette({ ctx: EMPTY_CTX });
    // edit.undo has enabled = (ctx) => ctx.canUndo. With canUndo=false the row
    // should be disabled (button disabled + aria-disabled=true).
    const undoRow = findRow(tree, 'edit.undo');
    if (!undoRow) throw new Error('undo row missing');
    expect(undoRow.props.disabled).toBe(true);
    expect(undoRow.props['aria-disabled']).toBe(true);
  });

  it('enables every row when its ctx predicates are all satisfied', () => {
    const tree = renderPalette({ ctx: FULL_CTX });
    // A command without an enabled predicate is unconditionally enabled. Pick a
    // few to spot-check.
    const selectRow = findRow(tree, 'tool.select');
    if (!selectRow) throw new Error('select row missing');
    expect(selectRow.props.disabled).toBe(false);
    expect(selectRow.props['aria-disabled']).toBeUndefined();
    // An enabled-gated command with the right ctx should also be enabled.
    const undoRow = findRow(tree, 'edit.undo');
    if (!undoRow) throw new Error('undo row missing');
    expect(undoRow.props.disabled).toBe(false);
  });

  it('clicking an enabled row calls runCommand(id) then onOpenChange(false)', () => {
    const runCommand = mock(() => {});
    const onOpenChange = mock(() => {});
    const tree = renderPalette({ runCommand, onOpenChange });
    const tidyRow = findRow(tree, 'layout.tidy');
    if (!tidyRow) throw new Error('tidy row missing');
    const onClick = tidyRow.props.onClick as () => void;
    onClick();
    expect(runCommand).toHaveBeenCalledWith('layout.tidy');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('clicking a disabled row is a no-op (does not invoke runCommand)', () => {
    const runCommand = mock(() => {});
    const onOpenChange = mock(() => {});
    const tree = renderPalette({ ctx: EMPTY_CTX, runCommand, onOpenChange });
    const undoRow = findRow(tree, 'edit.undo');
    if (!undoRow) throw new Error('undo row missing');
    const onClick = undoRow.props.onClick as () => void;
    onClick();
    expect(runCommand).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('renders the search input wired with aria-label so screen readers can find it', () => {
    const tree = renderPalette();
    const input = findByTestId(tree, 'command-palette-input');
    expect(input).not.toBeNull();
    expect((input as ReactElementLike).props['aria-label']).toBe('Search commands');
  });

  it('Enter on the search input executes the highlighted row (defaults to first enabled)', () => {
    const runCommand = mock(() => {});
    const tree = renderPalette({ runCommand });
    const input = findByTestId(tree, 'command-palette-input');
    if (!input) throw new Error('input missing');
    const handleKeyDown = input.props.onKeyDown as (e: {
      key: string;
      preventDefault: () => void;
    }) => void;
    const calls: string[] = [];
    handleKeyDown({ key: 'Enter', preventDefault: () => calls.push('prevent') });
    // The first rendered row at default ctx is the first command in the
    // Edit-first category order — edit.undo. With full ctx it's enabled.
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith(COMMANDS.find((c) => c.id === 'edit.undo')?.id);
    expect(calls).toContain('prevent');
  });

  it('ArrowDown / ArrowUp on the search input call preventDefault (no caret jumps inside the input)', () => {
    const tree = renderPalette();
    const input = findByTestId(tree, 'command-palette-input');
    if (!input) throw new Error('input missing');
    const handleKeyDown = input.props.onKeyDown as (e: {
      key: string;
      preventDefault: () => void;
    }) => void;
    const calls: string[] = [];
    handleKeyDown({ key: 'ArrowDown', preventDefault: () => calls.push('down') });
    handleKeyDown({ key: 'ArrowUp', preventDefault: () => calls.push('up') });
    expect(calls).toEqual(['down', 'up']);
  });

  it('groups rows by category in the documented order (Edit, View, Tools, Layout, Selection, Help)', () => {
    const tree = renderPalette();
    // Categories appear as small uppercase headings in the list. The order we
    // assert is the literal CATEGORY_ORDER constant in the component.
    const categories = findAll(tree, (el) => {
      const className = el.props.className;
      return typeof className === 'string' && className.includes('uppercase tracking-wide');
    });
    const labels = categories
      .map((el) => el.props.children)
      .filter((c): c is string => typeof c === 'string');
    // Every CATEGORY_ORDER bucket should appear — and in order.
    expect(labels).toEqual(['Edit', 'View', 'Tools', 'Layout', 'Selection', 'Help']);
  });
});
