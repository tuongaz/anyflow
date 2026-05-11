import { describe, expect, it, mock } from 'bun:test';
import { ShareMenu, type ShareMenuProps } from '@/components/share-menu';
import * as React from 'react';

// Same dispatcher-shim trick used elsewhere (icon-picker-popover.test, icon-node.test):
// apps/web tests run without a DOM, so we shim React's internal hook dispatcher
// and call ShareMenu as a function. Sub-component bodies (DropdownMenu, etc.) are
// captured as placeholders — we walk the returned tree to assert structure.
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

function renderShareMenu(props: Partial<ShareMenuProps>): unknown {
  return renderWithHooks(() =>
    (ShareMenu as unknown as (p: ShareMenuProps) => unknown)({ ...props }),
  );
}

describe('ShareMenu', () => {
  it('renders null when neither callback is provided (no-demo state hides the affordance)', () => {
    const tree = renderShareMenu({});
    expect(tree).toBeNull();
  });

  it('renders the trigger button when at least one callback is wired', () => {
    const tree = renderShareMenu({ onDownloadPng: () => {} });
    const trigger = findByTestId(tree, 'share-menu-trigger');
    expect(trigger).not.toBeNull();
    const ariaLabel = (trigger as ReactElementLike).props['aria-label'];
    expect(ariaLabel).toBe('Share / download');
    const title = (trigger as ReactElementLike).props.title;
    expect(title).toBe('Share / download');
  });

  it('renders the PDF item when onDownloadPdf is wired', () => {
    const tree = renderShareMenu({ onDownloadPdf: () => {} });
    const pdfItem = findByTestId(tree, 'share-menu-pdf');
    expect(pdfItem).not.toBeNull();
    const pngItem = findByTestId(tree, 'share-menu-png');
    expect(pngItem).toBeNull();
  });

  it('renders the PNG item when onDownloadPng is wired', () => {
    const tree = renderShareMenu({ onDownloadPng: () => {} });
    const pngItem = findByTestId(tree, 'share-menu-png');
    expect(pngItem).not.toBeNull();
    const pdfItem = findByTestId(tree, 'share-menu-pdf');
    expect(pdfItem).toBeNull();
  });

  it('renders both items when both callbacks are wired', () => {
    const tree = renderShareMenu({ onDownloadPdf: () => {}, onDownloadPng: () => {} });
    expect(findByTestId(tree, 'share-menu-pdf')).not.toBeNull();
    expect(findByTestId(tree, 'share-menu-png')).not.toBeNull();
  });

  it('selecting the PDF item calls onDownloadPdf', () => {
    const onDownloadPdf = mock(() => Promise.resolve());
    const tree = renderShareMenu({ onDownloadPdf });
    const pdfItem = findByTestId(tree, 'share-menu-pdf');
    if (!pdfItem) throw new Error('PDF item missing');
    const onSelect = pdfItem.props.onSelect as (e: Event) => void;
    onSelect({ preventDefault: () => {} } as unknown as Event);
    expect(onDownloadPdf).toHaveBeenCalledTimes(1);
  });

  it('selecting the PNG item calls onDownloadPng', () => {
    const onDownloadPng = mock(() => Promise.resolve());
    const tree = renderShareMenu({ onDownloadPng });
    const pngItem = findByTestId(tree, 'share-menu-png');
    if (!pngItem) throw new Error('PNG item missing');
    const onSelect = pngItem.props.onSelect as (e: Event) => void;
    onSelect({ preventDefault: () => {} } as unknown as Event);
    expect(onDownloadPng).toHaveBeenCalledTimes(1);
  });

  it('selecting a menu item calls preventDefault so the popover stays open until the export settles', () => {
    const onDownloadPng = mock(() => Promise.resolve());
    const preventDefault = mock(() => {});
    const tree = renderShareMenu({ onDownloadPng });
    const pngItem = findByTestId(tree, 'share-menu-png');
    if (!pngItem) throw new Error('PNG item missing');
    const onSelect = pngItem.props.onSelect as (e: Event) => void;
    onSelect({ preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
