import { describe, expect, it } from 'bun:test';
import type { DemoSummary } from '@/lib/api';
import { pickInitialDemo } from '@/lib/last-project';

const summary = (id: string, slug: string): DemoSummary => ({
  id,
  slug,
  name: slug,
  repoPath: `/tmp/${slug}`,
  lastModified: 0,
  valid: true,
});

describe('pickInitialDemo', () => {
  it('returns null when there are no demos', () => {
    expect(pickInitialDemo([], null)).toBeNull();
    expect(pickInitialDemo([], 'anything')).toBeNull();
  });

  it('returns the demo matching the stored id when present', () => {
    const a = summary('a', 'alpha');
    const b = summary('b', 'beta');
    expect(pickInitialDemo([a, b], 'b')).toBe(b);
  });

  it('falls back to the first demo when stored id is missing', () => {
    const a = summary('a', 'alpha');
    const b = summary('b', 'beta');
    expect(pickInitialDemo([a, b], null)).toBe(a);
  });

  it('falls back to the first demo when stored id is no longer in the registry', () => {
    const a = summary('a', 'alpha');
    const b = summary('b', 'beta');
    expect(pickInitialDemo([a, b], 'gone')).toBe(a);
  });
});
