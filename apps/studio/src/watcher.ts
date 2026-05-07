import { type FSWatcher, existsSync, readFileSync, watch } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { EventBus } from './events.ts';
import type { Registry } from './registry.ts';
import { type Demo, DemoSchema } from './schema.ts';

const DEFAULT_DEBOUNCE_MS = 100;

export interface DemoSnapshot {
  /** Last successfully parsed demo, if we ever saw one. */
  demo: Demo | null;
  /** Result of the most recent parse attempt. */
  valid: boolean;
  /** Human-readable error from the most recent parse, when `valid: false`. */
  error: string | null;
  /** Absolute path on disk this snapshot was read from. */
  filePath: string;
  /** Server timestamp of the most recent parse attempt. */
  parsedAt: number;
}

export interface WatcherDeps {
  registry: Registry;
  events: EventBus;
  /** Override for tests. */
  debounceMs?: number;
}

export interface DemoWatcher {
  /** Read the current snapshot for a demo, or null if unknown. */
  snapshot(demoId: string): DemoSnapshot | null;
  /** Begin watching the file backing the given demo id. Idempotent. */
  watch(demoId: string): void;
  /** Stop watching a single demo. */
  unwatch(demoId: string): void;
  /** Start watchers for every entry currently in the registry. */
  watchAll(): void;
  /** Stop everything (used in tests + on shutdown). */
  closeAll(): void;
  /** Force a reparse synchronously. Useful for tests + initial load. */
  reparse(demoId: string): DemoSnapshot | null;
}

interface WatchHandle {
  fsWatcher: FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  filePath: string;
}

const resolveFilePath = (repoPath: string, demoPath: string): string =>
  isAbsolute(demoPath) ? demoPath : join(repoPath, demoPath);

export function createWatcher(deps: WatcherDeps): DemoWatcher {
  const { registry, events } = deps;
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const handles = new Map<string, WatchHandle>();
  const snapshots = new Map<string, DemoSnapshot>();

  const reparse = (demoId: string): DemoSnapshot | null => {
    const entry = registry.getById(demoId);
    if (!entry) return null;
    const filePath = resolveFilePath(entry.repoPath, entry.demoPath);

    const previous = snapshots.get(demoId) ?? null;
    let next: DemoSnapshot;

    if (!existsSync(filePath)) {
      next = {
        demo: previous?.demo ?? null,
        valid: false,
        error: `Demo file not found: ${filePath}`,
        filePath,
        parsedAt: Date.now(),
      };
    } else {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch (err) {
        next = {
          demo: previous?.demo ?? null,
          valid: false,
          error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
          filePath,
          parsedAt: Date.now(),
        };
        snapshots.set(demoId, next);
        return next;
      }

      const parsed = DemoSchema.safeParse(raw);
      if (!parsed.success) {
        const message = parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ');
        next = {
          demo: previous?.demo ?? null,
          valid: false,
          error: `Schema validation failed: ${message}`,
          filePath,
          parsedAt: Date.now(),
        };
      } else {
        next = {
          demo: parsed.data,
          valid: true,
          error: null,
          filePath,
          parsedAt: Date.now(),
        };
      }
    }

    snapshots.set(demoId, next);
    return next;
  };

  const broadcastReload = (demoId: string, snap: DemoSnapshot) => {
    events.broadcast({
      type: 'demo:reload',
      demoId,
      payload: snap.valid ? { valid: true, demo: snap.demo } : { valid: false, error: snap.error },
    });
  };

  const startWatch = (demoId: string) => {
    const existing = handles.get(demoId);
    if (existing) {
      existing.fsWatcher.close();
      if (existing.debounceTimer) clearTimeout(existing.debounceTimer);
      handles.delete(demoId);
    }

    const entry = registry.getById(demoId);
    if (!entry) return;

    const filePath = resolveFilePath(entry.repoPath, entry.demoPath);
    const dir = dirname(filePath);
    const base = basename(filePath);

    if (!existsSync(dir)) {
      // Directory missing — record an invalid snapshot but don't try to watch.
      const snap = reparse(demoId);
      if (snap) broadcastReload(demoId, snap);
      return;
    }

    let fsWatcher: FSWatcher;
    try {
      fsWatcher = watch(dir, { persistent: true }, (_event, changed) => {
        // Only react to the demo file (or to events with no filename, which
        // some platforms emit for rename-on-save patterns).
        if (changed && changed !== base) return;
        const handle = handles.get(demoId);
        if (!handle) return;
        if (handle.debounceTimer) clearTimeout(handle.debounceTimer);
        handle.debounceTimer = setTimeout(() => {
          handle.debounceTimer = null;
          const snap = reparse(demoId);
          if (snap) broadcastReload(demoId, snap);
        }, debounceMs);
      });
    } catch (err) {
      console.error(`[watcher] failed to watch ${dir} for demo ${demoId}:`, err);
      const snap = reparse(demoId);
      if (snap) broadcastReload(demoId, snap);
      return;
    }

    handles.set(demoId, { fsWatcher, debounceTimer: null, filePath });

    // Seed the snapshot from disk so callers can serve GET /api/demos/:id
    // without having to wait for the first fs event.
    reparse(demoId);
  };

  return {
    snapshot(demoId) {
      return snapshots.get(demoId) ?? null;
    },
    watch(demoId) {
      startWatch(demoId);
    },
    unwatch(demoId) {
      const h = handles.get(demoId);
      if (!h) return;
      h.fsWatcher.close();
      if (h.debounceTimer) clearTimeout(h.debounceTimer);
      handles.delete(demoId);
      snapshots.delete(demoId);
    },
    watchAll() {
      for (const entry of registry.list()) startWatch(entry.id);
    },
    closeAll() {
      for (const [, h] of handles) {
        h.fsWatcher.close();
        if (h.debounceTimer) clearTimeout(h.debounceTimer);
      }
      handles.clear();
      snapshots.clear();
    },
    reparse,
  };
}
