import { beforeEach, describe, expect, it } from 'bun:test';

const memStore = new Map<string, string>();
const mockLocalStorage = {
  getItem: (k: string): string | null => memStore.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    memStore.set(k, v);
  },
  removeItem: (k: string): void => {
    memStore.delete(k);
  },
};

(globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = mockLocalStorage;

const { getLastUsedStyle, rememberNodeStyle, rememberConnectorStyle } = await import(
  '@/lib/last-used-style'
);

const STORAGE_KEY = 'anydemo:last-used-style:v1';

beforeEach(() => {
  memStore.clear();
});

describe('getLastUsedStyle', () => {
  it('returns empty buckets when the key is missing', () => {
    expect(getLastUsedStyle()).toEqual({ node: {}, connector: {} });
  });

  it('returns empty buckets when the stored JSON is corrupt', () => {
    memStore.set(STORAGE_KEY, '{not json');
    expect(getLastUsedStyle()).toEqual({ node: {}, connector: {} });
  });

  it('returns empty buckets when the stored payload is JSON but the wrong shape', () => {
    memStore.set(STORAGE_KEY, JSON.stringify(['array', 'not', 'object']));
    expect(getLastUsedStyle()).toEqual({ node: {}, connector: {} });
  });

  it('coerces a non-object `node` sub-bucket to an empty object', () => {
    memStore.set(STORAGE_KEY, JSON.stringify({ node: 'wat', connector: { color: 'blue' } }));
    expect(getLastUsedStyle()).toEqual({ node: {}, connector: { color: 'blue' } });
  });

  it('round-trips a stored payload', () => {
    memStore.set(
      STORAGE_KEY,
      JSON.stringify({ node: { borderColor: 'blue' }, connector: { style: 'dashed' } }),
    );
    expect(getLastUsedStyle()).toEqual({
      node: { borderColor: 'blue' },
      connector: { style: 'dashed' },
    });
  });
});

describe('rememberNodeStyle', () => {
  it('stores a node patch into the node bucket', () => {
    rememberNodeStyle({ borderColor: 'blue' });
    expect(getLastUsedStyle().node).toEqual({ borderColor: 'blue' });
  });

  it('shallow-merges successive patches', () => {
    rememberNodeStyle({ borderColor: 'blue' });
    rememberNodeStyle({ backgroundColor: 'red' });
    expect(getLastUsedStyle().node).toEqual({ borderColor: 'blue', backgroundColor: 'red' });
  });

  it('later writes override earlier writes for the same field', () => {
    rememberNodeStyle({ borderColor: 'blue' });
    rememberNodeStyle({ borderColor: 'green' });
    expect(getLastUsedStyle().node).toEqual({ borderColor: 'green' });
  });

  it('strips `alt` (content, not style)', () => {
    rememberNodeStyle({ alt: 'a server', color: 'amber' });
    expect(getLastUsedStyle().node).toEqual({ color: 'amber' });
    expect('alt' in getLastUsedStyle().node).toBe(false);
  });

  it('mirrors borderSize → borderWidth on write', () => {
    rememberNodeStyle({ borderSize: 4 });
    expect(getLastUsedStyle().node).toEqual({ borderSize: 4, borderWidth: 4 });
  });

  it('mirrors borderWidth → borderSize on write', () => {
    rememberNodeStyle({ borderWidth: 6 });
    expect(getLastUsedStyle().node).toEqual({ borderSize: 6, borderWidth: 6 });
  });

  it('does not clobber an explicit pairing when both fields are present', () => {
    rememberNodeStyle({ borderSize: 4, borderWidth: 6 });
    expect(getLastUsedStyle().node).toEqual({ borderSize: 4, borderWidth: 6 });
  });

  it('preserves the connector bucket', () => {
    rememberConnectorStyle({ style: 'dashed' });
    rememberNodeStyle({ borderColor: 'blue' });
    expect(getLastUsedStyle().connector).toEqual({ style: 'dashed' });
  });
});

describe('rememberConnectorStyle', () => {
  it('stores a connector patch into the connector bucket', () => {
    rememberConnectorStyle({ style: 'dashed' });
    expect(getLastUsedStyle().connector).toEqual({ style: 'dashed' });
  });

  it('shallow-merges successive patches', () => {
    rememberConnectorStyle({ style: 'dashed' });
    rememberConnectorStyle({ color: 'red' });
    expect(getLastUsedStyle().connector).toEqual({ style: 'dashed', color: 'red' });
  });

  it('preserves the node bucket', () => {
    rememberNodeStyle({ borderColor: 'blue' });
    rememberConnectorStyle({ style: 'dashed' });
    expect(getLastUsedStyle().node).toEqual({ borderColor: 'blue' });
  });
});

describe('storage failure modes', () => {
  it('rememberNodeStyle does not throw when setItem throws', () => {
    const throwingStorage: typeof mockLocalStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = throwingStorage;
    expect(() => rememberNodeStyle({ borderColor: 'blue' })).not.toThrow();
    // restore for subsequent tests
    (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = mockLocalStorage;
  });

  it('rememberConnectorStyle does not throw when setItem throws', () => {
    const throwingStorage: typeof mockLocalStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = throwingStorage;
    expect(() => rememberConnectorStyle({ style: 'dashed' })).not.toThrow();
    (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = mockLocalStorage;
  });

  it('getLastUsedStyle does not throw when getItem throws', () => {
    const throwingStorage: typeof mockLocalStorage = {
      getItem: () => {
        throw new Error('unavailable');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = throwingStorage;
    expect(getLastUsedStyle()).toEqual({ node: {}, connector: {} });
    (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = mockLocalStorage;
  });
});
