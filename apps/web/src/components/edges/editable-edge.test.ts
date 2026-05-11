import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// US-024 regression: clicking the visible portal endpoint dot must forward a
// synthetic `mousedown` to the underlying SVG `.react-flow__edgeupdater-{kind}`
// anchor so xyflow's reconnect-drag machinery runs unchanged. Bun's test env
// has no DOM, so we stub `document` / `MouseEvent` / `CSS` on globalThis,
// then exercise the exported helper directly. Asserts cover the lookup
// behavior, dispatch payload, and the "no anchor → no dispatch" branch that
// keeps the forwarding safe in degenerate DOMs (e.g. an edge that just
// unmounted between mousedown queueing and our handler firing).

type DispatchedEvent = {
  type: string;
  bubbles?: boolean;
  cancelable?: boolean;
  button?: number;
  buttons?: number;
  clientX?: number;
  clientY?: number;
};

type FakeAnchor = {
  dispatchEvent: (e: DispatchedEvent) => boolean;
  dispatched: DispatchedEvent[];
};

type FakeWrapper = {
  querySelector: (selector: string) => FakeAnchor | null;
};

const createFakeAnchor = (): FakeAnchor => {
  const dispatched: DispatchedEvent[] = [];
  return {
    dispatched,
    dispatchEvent: (e: DispatchedEvent) => {
      dispatched.push(e);
      return true;
    },
  };
};

const installFakeDom = (wrapperBySelector: (selector: string) => FakeWrapper | null): void => {
  const g = globalThis as Record<string, unknown>;
  g.document = {
    querySelector: (sel: string) => wrapperBySelector(sel),
  };
  g.CSS = { escape: (s: string) => s.replace(/"/g, '\\"') };
  // Capture the constructor args so the test can inspect them.
  g.MouseEvent = class {
    type: string;
    bubbles?: boolean;
    cancelable?: boolean;
    button?: number;
    buttons?: number;
    clientX?: number;
    clientY?: number;
    constructor(type: string, init: Record<string, unknown>) {
      this.type = type;
      this.bubbles = init.bubbles as boolean | undefined;
      this.cancelable = init.cancelable as boolean | undefined;
      this.button = init.button as number | undefined;
      this.buttons = init.buttons as number | undefined;
      this.clientX = init.clientX as number | undefined;
      this.clientY = init.clientY as number | undefined;
    }
  };
};

const uninstallFakeDom = (): void => {
  const g = globalThis as Record<string, unknown>;
  g.document = undefined;
  g.CSS = undefined;
  g.MouseEvent = undefined;
};

let dispatchReconnectMouseDownOnAnchor: (
  id: string,
  kind: 'source' | 'target',
  clientX: number,
  clientY: number,
) => boolean;

beforeEach(async () => {
  // Module imports xyflow which DOES touch window-side globals at module load
  // (React/JSX). The fake DOM has to be in place before the dynamic import.
  installFakeDom(() => null);
  const mod = await import('@/components/edges/editable-edge');
  dispatchReconnectMouseDownOnAnchor = mod.dispatchReconnectMouseDownOnAnchor;
});

afterEach(() => {
  uninstallFakeDom();
});

describe('dispatchReconnectMouseDownOnAnchor (US-024 forwarder)', () => {
  it('finds the matching SVG anchor for the source endpoint and dispatches a mousedown on it', () => {
    const sourceAnchor = createFakeAnchor();
    const targetAnchor = createFakeAnchor();
    const wrapper: FakeWrapper = {
      querySelector: (sel) => {
        if (sel === '.react-flow__edgeupdater-source') return sourceAnchor;
        if (sel === '.react-flow__edgeupdater-target') return targetAnchor;
        return null;
      },
    };
    let lookedUp = '';
    installFakeDom((sel) => {
      lookedUp = sel;
      if (sel === '.react-flow__edge[data-id="edge-42"]') return wrapper;
      return null;
    });

    const ok = dispatchReconnectMouseDownOnAnchor('edge-42', 'source', 100, 200);

    expect(ok).toBe(true);
    expect(lookedUp).toBe('.react-flow__edge[data-id="edge-42"]');
    expect(sourceAnchor.dispatched).toHaveLength(1);
    expect(targetAnchor.dispatched).toHaveLength(0);
    const [ev] = sourceAnchor.dispatched;
    if (!ev) throw new Error('dispatched event missing');
    expect(ev.type).toBe('mousedown');
    expect(ev.bubbles).toBe(true);
    expect(ev.button).toBe(0);
    expect(ev.clientX).toBe(100);
    expect(ev.clientY).toBe(200);
  });

  it('targets the target anchor when kind="target"', () => {
    const sourceAnchor = createFakeAnchor();
    const targetAnchor = createFakeAnchor();
    const wrapper: FakeWrapper = {
      querySelector: (sel) => {
        if (sel === '.react-flow__edgeupdater-source') return sourceAnchor;
        if (sel === '.react-flow__edgeupdater-target') return targetAnchor;
        return null;
      },
    };
    installFakeDom((sel) => (sel.includes('"edge-7"') ? wrapper : null));

    const ok = dispatchReconnectMouseDownOnAnchor('edge-7', 'target', 50, 75);

    expect(ok).toBe(true);
    expect(sourceAnchor.dispatched).toHaveLength(0);
    expect(targetAnchor.dispatched).toHaveLength(1);
    expect(targetAnchor.dispatched[0]?.clientX).toBe(50);
    expect(targetAnchor.dispatched[0]?.clientY).toBe(75);
  });

  it('returns false and dispatches nothing when the edge wrapper is missing', () => {
    const noopAnchor = createFakeAnchor();
    installFakeDom(() => null);
    const ok = dispatchReconnectMouseDownOnAnchor('does-not-exist', 'source', 1, 2);
    expect(ok).toBe(false);
    expect(noopAnchor.dispatched).toHaveLength(0);
  });

  it('returns false and dispatches nothing when the anchor circle is missing', () => {
    const sourceAnchor = createFakeAnchor();
    const wrapper: FakeWrapper = {
      // Wrapper exists but no anchor circle is rendered (e.g. mid-unmount).
      querySelector: () => null,
    };
    installFakeDom((sel) => (sel.includes('"edge-9"') ? wrapper : null));
    const ok = dispatchReconnectMouseDownOnAnchor('edge-9', 'source', 1, 2);
    expect(ok).toBe(false);
    expect(sourceAnchor.dispatched).toHaveLength(0);
  });

  it('escapes the id via CSS.escape so quotes and special chars in ids do not break the selector', () => {
    const anchor = createFakeAnchor();
    const wrapper: FakeWrapper = {
      querySelector: (sel) => (sel === '.react-flow__edgeupdater-source' ? anchor : null),
    };
    let lookedUp = '';
    installFakeDom((sel) => {
      lookedUp = sel;
      // CSS.escape stub escapes double quotes — the test verifies the helper
      // routes the id through CSS.escape so a malicious or malformed id can't
      // close out the attribute selector.
      if (sel === '.react-flow__edge[data-id="edge\\".weird"]') return wrapper;
      return null;
    });
    const ok = dispatchReconnectMouseDownOnAnchor('edge".weird', 'source', 0, 0);
    expect(ok).toBe(true);
    expect(lookedUp).toBe('.react-flow__edge[data-id="edge\\".weird"]');
  });
});

// Silence biome's "unused import" warning — `mock` is brought in to mirror the
// pattern used by the other apps/web test files, where future test additions
// may need it.
mock;
