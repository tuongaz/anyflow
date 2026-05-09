import type { DemoSummary } from '@/lib/api';

export const LAST_PROJECT_STORAGE_KEY = 'anydemo:last-project';

export const readLastProjectId = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const writeLastProjectId = (id: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, id);
  } catch {
    // localStorage may be unavailable (private mode, quota, etc.) — non-fatal.
  }
};

/**
 * Pick which demo to show when the user lands on `/`.
 *
 * Priority:
 *   1. The demo whose id matches the stored last-used id (if it's still in the registry).
 *   2. The first demo in the registry.
 *   3. `null` — caller falls back to empty state.
 */
export const pickInitialDemo = (
  demos: DemoSummary[],
  lastId: string | null,
): DemoSummary | null => {
  if (demos.length === 0) return null;
  if (lastId) {
    const match = demos.find((d) => d.id === lastId);
    if (match) return match;
  }
  return demos[0] ?? null;
};
