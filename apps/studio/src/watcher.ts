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
  /**
   * Relative paths (under `<project>/.anydemo/`) currently being watched
   * because they're referenced by a node's `data.htmlPath` or `data.path`.
   * Sorted for stable assertion order. Used by tests.
   */
  referencedPaths(demoId: string): string[];
}

interface FileWatchEntry {
  fsWatcher: FSWatcher;
  /** basename → relative path (rooted at `<project>/.anydemo/`) */
  files: Map<string, string>;
  /** basename → pending debounce timer for the next broadcast */
  timers: Map<string, ReturnType<typeof setTimeout>>;
}

interface WatchHandle {
  fsWatcher: FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  filePath: string;
  /**
   * Per-directory file watchers for files referenced by node data
   * (`htmlPath`, imageNode `path`). Each directory watcher dispatches to
   * specific basenames in its `files` map.
   */
  fileWatchers: Map<string, FileWatchEntry>;
}

const resolveFilePath = (repoPath: string, demoPath: string): string =>
  isAbsolute(demoPath) ? demoPath : join(repoPath, demoPath);

const isCleanRelativePath = (p: string): boolean => {
  if (!p) return false;
  // Reject data URLs early — the pre-launch hard-cut (US-004) replaces
  // imageNode.data.image with data.path, but defensively skip any lingering
  // base64 payloads so we don't try to fs.watch a 5MB string.
  if (p.startsWith('data:')) return false;
  if (isAbsolute(p) || p.startsWith('/') || p.startsWith('\\')) return false;
  const segments = p.split(/[\\/]/);
  if (segments.some((s) => s === '..')) return false;
  return true;
};

/**
 * Walk raw demo JSON (pre-schema-parse) collecting referenced file paths:
 * `nodes[].data.htmlPath` (htmlNode) and `nodes[].data.path` (imageNode after
 * US-004). Operates on the raw JSON so the watcher works before those fields
 * are formally declared in the schema — Zod's default-strip would drop them
 * during validation, but the file watcher still needs to know about them.
 */
const collectReferencedPaths = (raw: unknown): string[] => {
  if (!raw || typeof raw !== 'object') return [];
  const nodes = (raw as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  const out = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const data = (node as { data?: unknown }).data;
    if (!data || typeof data !== 'object') continue;
    const d = data as { htmlPath?: unknown; path?: unknown };
    for (const candidate of [d.htmlPath, d.path]) {
      if (typeof candidate !== 'string') continue;
      if (!isCleanRelativePath(candidate)) continue;
      out.add(candidate);
    }
  }
  return [...out];
};

const closeFileWatchers = (handle: WatchHandle): void => {
  for (const entry of handle.fileWatchers.values()) {
    entry.fsWatcher.close();
    for (const t of entry.timers.values()) clearTimeout(t);
  }
  handle.fileWatchers.clear();
};

export function createWatcher(deps: WatcherDeps): DemoWatcher {
  const { registry, events } = deps;
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const handles = new Map<string, WatchHandle>();
  const snapshots = new Map<string, DemoSnapshot>();

  // Reconcile the file-watch set for `demoId` against the desired referenced
  // paths. Closes watchers for dirs that disappeared, updates the basename
  // map for dirs that survived, opens new fs.watch handles for new dirs.
  const reconcileFileWatchers = (
    demoId: string,
    handle: WatchHandle,
    anydemoRoot: string,
    refs: string[],
  ): void => {
    const desired = new Map<string, Map<string, string>>();
    for (const relPath of refs) {
      const abs = join(anydemoRoot, relPath);
      const dir = dirname(abs);
      const base = basename(abs);
      let dirMap = desired.get(dir);
      if (!dirMap) {
        dirMap = new Map();
        desired.set(dir, dirMap);
      }
      dirMap.set(base, relPath);
    }

    // Close watchers for directories no longer referenced.
    for (const [dir, entry] of handle.fileWatchers) {
      if (!desired.has(dir)) {
        entry.fsWatcher.close();
        for (const t of entry.timers.values()) clearTimeout(t);
        handle.fileWatchers.delete(dir);
      }
    }

    // Add or update watchers for desired directories.
    for (const [dir, files] of desired) {
      const existing = handle.fileWatchers.get(dir);
      if (existing) {
        existing.files = files;
        // Drop pending timers for basenames no longer in scope.
        for (const base of [...existing.timers.keys()]) {
          if (!files.has(base)) {
            const t = existing.timers.get(base);
            if (t) clearTimeout(t);
            existing.timers.delete(base);
          }
        }
        continue;
      }

      if (!existsSync(dir)) {
        // Directory hasn't been created on disk yet (e.g. blocks/ before any
        // htmlNode is dropped). Skip silently — next reparse will retry.
        continue;
      }

      let fsWatcher: FSWatcher;
      try {
        fsWatcher = watch(dir, { persistent: true }, (_event, changed) => {
          if (!changed) return;
          const cur = handle.fileWatchers.get(dir);
          if (!cur) return;
          const rel = cur.files.get(changed);
          if (!rel) return;
          const existingTimer = cur.timers.get(changed);
          if (existingTimer) clearTimeout(existingTimer);
          const timer = setTimeout(() => {
            cur.timers.delete(changed);
            events.broadcast({
              type: 'file:changed',
              demoId,
              payload: { path: rel },
            });
          }, debounceMs);
          cur.timers.set(changed, timer);
        });
      } catch (err) {
        console.error(`[watcher] failed to watch ${dir} for demo ${demoId}:`, err);
        continue;
      }

      handle.fileWatchers.set(dir, {
        fsWatcher,
        files,
        timers: new Map(),
      });
    }
  };

  const reparse = (demoId: string): DemoSnapshot | null => {
    const entry = registry.getById(demoId);
    if (!entry) return null;
    const filePath = resolveFilePath(entry.repoPath, entry.demoPath);

    const previous = snapshots.get(demoId) ?? null;
    const parsedAt = Date.now();
    const fail = (error: string): DemoSnapshot => ({
      demo: previous?.demo ?? null,
      valid: false,
      error,
      filePath,
      parsedAt,
    });

    let next: DemoSnapshot;
    let raw: unknown = null;
    let rawOk = false;

    if (!existsSync(filePath)) {
      next = fail(`Demo file not found: ${filePath}`);
    } else {
      let parseError: string | null = null;
      try {
        raw = JSON.parse(readFileSync(filePath, 'utf8'));
        rawOk = true;
      } catch (err) {
        parseError = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
      }

      if (!rawOk) {
        next = fail(parseError ?? 'Invalid JSON');
      } else {
        const parsed = DemoSchema.safeParse(raw);
        if (!parsed.success) {
          const message = parsed.error.issues
            .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('; ');
          next = fail(`Schema validation failed: ${message}`);
        } else {
          next = { demo: parsed.data, valid: true, error: null, filePath, parsedAt };
        }
      }
    }

    snapshots.set(demoId, next);

    // Recompute the referenced-files watch set whenever raw JSON parsed
    // cleanly (regardless of schema validity). Schema errors shouldn't drop
    // the watch set — the user is mid-edit and the referenced files are
    // still valid targets.
    if (rawOk) {
      const handle = handles.get(demoId);
      if (handle) {
        reconcileFileWatchers(
          demoId,
          handle,
          join(entry.repoPath, '.anydemo'),
          collectReferencedPaths(raw),
        );
      }
    }

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
      closeFileWatchers(existing);
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

    handles.set(demoId, {
      fsWatcher,
      debounceTimer: null,
      filePath,
      fileWatchers: new Map(),
    });

    // Seed the snapshot from disk so callers can serve GET /api/demos/:id
    // without having to wait for the first fs event. Also seeds the
    // referenced-file watch set via reconcileFileWatchers().
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
      closeFileWatchers(h);
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
        closeFileWatchers(h);
      }
      handles.clear();
      snapshots.clear();
    },
    reparse,
    referencedPaths(demoId) {
      const h = handles.get(demoId);
      if (!h) return [];
      const paths: string[] = [];
      for (const entry of h.fileWatchers.values()) {
        for (const rel of entry.files.values()) paths.push(rel);
      }
      return paths.sort();
    },
  };
}
