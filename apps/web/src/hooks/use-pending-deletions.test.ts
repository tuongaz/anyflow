import { describe, expect, it } from 'bun:test';
import {
  applyMark,
  applyMarkMany,
  applyPruneDeletionsAgainst,
  applyUnmark,
  applyUnmarkMany,
} from '@/hooks/use-pending-deletions';

const setOf = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe('applyMark', () => {
  it('adds an id to an empty set', () => {
    const next = applyMark(setOf(), 'a');
    expect([...next]).toEqual(['a']);
  });

  it('returns the same reference when the id is already marked', () => {
    const prev = setOf('a');
    const next = applyMark(prev, 'a');
    expect(next).toBe(prev);
  });
});

describe('applyMarkMany', () => {
  it('adds every new id and skips duplicates', () => {
    const prev = setOf('a');
    const next = applyMarkMany(prev, ['a', 'b', 'c']);
    expect(new Set(next)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('returns the same reference when no id is new', () => {
    const prev = setOf('a', 'b');
    const next = applyMarkMany(prev, ['a', 'b']);
    expect(next).toBe(prev);
  });

  it('returns the same reference when given an empty list', () => {
    const prev = setOf('a');
    expect(applyMarkMany(prev, [])).toBe(prev);
  });
});

describe('applyUnmark', () => {
  it('removes an id from the set', () => {
    const next = applyUnmark(setOf('a', 'b'), 'a');
    expect([...next]).toEqual(['b']);
  });

  it('returns the same reference when the id is absent', () => {
    const prev = setOf('a');
    expect(applyUnmark(prev, 'b')).toBe(prev);
  });
});

describe('applyUnmarkMany', () => {
  it('removes every id present', () => {
    const next = applyUnmarkMany(setOf('a', 'b', 'c'), ['a', 'c']);
    expect([...next].sort()).toEqual(['b']);
  });

  it('returns the same reference when none of the ids are present', () => {
    const prev = setOf('a');
    expect(applyUnmarkMany(prev, ['b', 'c'])).toBe(prev);
  });
});

describe('applyPruneDeletionsAgainst', () => {
  it('drops ids that the server snapshot no longer contains', () => {
    const prev = setOf('a', 'b', 'c');
    const next = applyPruneDeletionsAgainst(prev, [{ id: 'b' }]);
    // 'a' and 'c' are gone from the server (delete confirmed) → drop them.
    // 'b' is still on the server (delete in flight) → keep it suppressed.
    expect(new Set(next)).toEqual(new Set(['b']));
  });

  it('returns the same reference when nothing changes', () => {
    const prev = setOf('a');
    const next = applyPruneDeletionsAgainst(prev, [{ id: 'a' }]);
    expect(next).toBe(prev);
  });

  it('returns the same reference for an empty set', () => {
    const prev = setOf();
    expect(applyPruneDeletionsAgainst(prev, [{ id: 'a' }])).toBe(prev);
  });
});
