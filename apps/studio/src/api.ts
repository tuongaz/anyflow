import { existsSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { EventBus } from './events.ts';
import { fetchDynamicDetail, runPlay } from './proxy.ts';
import type { Registry } from './registry.ts';
import { DemoSchema } from './schema.ts';
import type { DemoSnapshot, DemoWatcher } from './watcher.ts';

const RegisterBodySchema = z.object({
  name: z.string().min(1).optional(),
  repoPath: z.string().min(1),
  demoPath: z.string().min(1),
});

const EmitBodySchema = z.object({
  demoId: z.string().min(1),
  nodeId: z.string().min(1),
  status: z.enum(['running', 'done', 'error']),
  runId: z.string().optional(),
  payload: z.unknown().optional(),
});

const PositionBodySchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

// Per-demo serialization: read-modify-write of the demo file isn't atomic
// across multiple PATCHes, so two concurrent drags would race
// (later writer's older read clobbers the earlier writer's update). We chain
// position writes per demoId so the read+write sequence is effectively
// serialized.
const demoWriteChains = new Map<string, Promise<unknown>>();
const withDemoWriteLock = <T>(demoId: string, fn: () => Promise<T>): Promise<T> => {
  const prev = demoWriteChains.get(demoId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Replace with a tail that swallows errors so the chain keeps moving even
  // if one write fails — but the original promise still rejects to its caller.
  demoWriteChains.set(
    demoId,
    next.catch(() => undefined),
  );
  return next as Promise<T>;
};

/**
 * Atomic write: writes to a sibling tempfile then renames over the target.
 * `rename(2)` is atomic on POSIX, so a process reading mid-write either sees
 * the old file or the new one — never a half-written one. This keeps user
 * editor diffs clean (single fs.watch event for the rename) and means a crash
 * during write can never corrupt the original.
 */
const writeFileAtomic = (filePath: string, content: string): void => {
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tempPath, content);
    renameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
};

const EMIT_STATUS_TO_EVENT = {
  running: 'node:running',
  done: 'node:done',
  error: 'node:error',
} as const;

export interface ApiOptions {
  registry: Registry;
  events?: EventBus;
  watcher?: DemoWatcher;
}

const resolveDemoPath = (repoPath: string, demoPath: string): string =>
  isAbsolute(demoPath) ? demoPath : join(repoPath, demoPath);

export function createApi(options: ApiOptions): Hono {
  const { registry, events, watcher } = options;
  const api = new Hono();

  api.post('/demos/register', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }

    const parsed = RegisterBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid register body', issues: parsed.error.issues }, 400);
    }

    const { repoPath, demoPath } = parsed.data;
    const fullPath = resolveDemoPath(repoPath, demoPath);

    if (!existsSync(fullPath)) {
      return c.json({ error: `Demo file not found: ${fullPath}` }, 400);
    }

    let demo: unknown;
    try {
      demo = await Bun.file(fullPath).json();
    } catch (err) {
      return c.json({ error: 'Demo file is not valid JSON', detail: String(err) }, 400);
    }

    const demoParse = DemoSchema.safeParse(demo);
    if (!demoParse.success) {
      return c.json(
        { error: 'Demo file failed schema validation', issues: demoParse.error.issues },
        400,
      );
    }

    const lastModified = statSync(fullPath).mtimeMs;
    const entry = registry.upsert({
      name: parsed.data.name ?? demoParse.data.name,
      repoPath,
      demoPath,
      valid: true,
      lastModified,
    });

    watcher?.watch(entry.id);

    return c.json({ id: entry.id, slug: entry.slug });
  });

  api.get('/demos', (c) => {
    return c.json(
      registry.list().map((e) => {
        const fullPath = resolveDemoPath(e.repoPath, e.demoPath);
        const fileExists = existsSync(fullPath);
        return {
          id: e.id,
          slug: e.slug,
          name: e.name,
          repoPath: e.repoPath,
          lastModified: e.lastModified,
          valid: e.valid && fileExists,
        };
      }),
    );
  });

  api.get('/demos/:id', async (c) => {
    const id = c.req.param('id');
    const entry = registry.getById(id);
    if (!entry) return c.json({ error: 'not found' }, 404);

    const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
    const snap = watcher?.snapshot(id) ?? watcher?.reparse(id) ?? null;

    const buildResponse = (s: DemoSnapshot) =>
      c.json({
        id: entry.id,
        slug: entry.slug,
        name: entry.name,
        filePath: fullPath,
        demo: s.demo,
        valid: s.valid,
        error: s.valid ? null : s.error,
      });

    if (snap) return buildResponse(snap);

    // No watcher — fall back to a one-shot synchronous read.
    if (!existsSync(fullPath)) {
      return c.json({ error: `Demo file not found: ${fullPath}` }, 404);
    }
    let raw: unknown;
    try {
      raw = await Bun.file(fullPath).json();
    } catch (err) {
      return buildResponse({
        demo: null,
        valid: false,
        error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        filePath: fullPath,
        parsedAt: Date.now(),
      });
    }
    const parsed = DemoSchema.safeParse(raw);
    if (!parsed.success) {
      return buildResponse({
        demo: null,
        valid: false,
        error: parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; '),
        filePath: fullPath,
        parsedAt: Date.now(),
      });
    }
    return buildResponse({
      demo: parsed.data,
      valid: true,
      error: null,
      filePath: fullPath,
      parsedAt: Date.now(),
    });
  });

  api.delete('/demos/:id', (c) => {
    const id = c.req.param('id');
    watcher?.unwatch(id);
    const removed = registry.remove(id);
    if (!removed) return c.json({ ok: false, error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  api.post('/demos/:id/play/:nodeId', async (c) => {
    const id = c.req.param('id');
    const nodeId = c.req.param('nodeId');
    const entry = registry.getById(id);
    if (!entry) return c.json({ error: 'unknown demo' }, 404);
    if (!events) return c.json({ error: 'events not enabled' }, 500);

    // Always re-read from disk so the user's most recent edit (validated or
    // not yet observed by the watcher) drives the actual fetch.
    const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
    if (!existsSync(fullPath)) {
      return c.json({ error: `Demo file not found: ${fullPath}` }, 404);
    }
    let raw: unknown;
    try {
      raw = await Bun.file(fullPath).json();
    } catch (err) {
      return c.json(
        {
          error: `Demo file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
        400,
      );
    }
    const parsed = DemoSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Demo failed schema validation', issues: parsed.error.issues }, 400);
    }

    const node = parsed.data.nodes.find((n) => n.id === nodeId);
    if (!node) return c.json({ error: `Unknown nodeId: ${nodeId}` }, 404);
    if (node.type === 'shapeNode' || !node.data.playAction) {
      return c.json({ error: `Node ${nodeId} has no playAction` }, 400);
    }

    const result = await runPlay({
      events,
      demoId: id,
      nodeId,
      action: node.data.playAction,
    });
    return c.json(result);
  });

  api.post('/demos/:id/nodes/:nodeId/detail', async (c) => {
    const id = c.req.param('id');
    const nodeId = c.req.param('nodeId');
    const entry = registry.getById(id);
    if (!entry) return c.json({ error: 'unknown demo' }, 404);

    // Re-read on each call so the user's latest edit drives the dynamic fetch.
    const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
    if (!existsSync(fullPath)) {
      return c.json({ error: `Demo file not found: ${fullPath}` }, 404);
    }
    let raw: unknown;
    try {
      raw = await Bun.file(fullPath).json();
    } catch (err) {
      return c.json(
        {
          error: `Demo file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
        400,
      );
    }
    const parsed = DemoSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Demo failed schema validation', issues: parsed.error.issues }, 400);
    }

    const node = parsed.data.nodes.find((n) => n.id === nodeId);
    if (!node) return c.json({ error: `Unknown nodeId: ${nodeId}` }, 404);

    const dynamicSource = node.type === 'shapeNode' ? undefined : node.data.detail?.dynamicSource;
    if (!dynamicSource) {
      return c.json({ error: `Node ${nodeId} has no dynamicSource` }, 404);
    }

    const result = await fetchDynamicDetail(dynamicSource);
    return c.json(result);
  });

  // PATCH a single node's position back into the on-disk demo.json. This is
  // the second (and only other) place the studio mutates user files — the
  // first being the SDK helper write in `register`. Atomic write via tempfile
  // + rename keeps editor diffs clean and avoids corruption mid-write.
  api.patch('/demos/:id/nodes/:nodeId/position', async (c) => {
    const id = c.req.param('id');
    const nodeId = c.req.param('nodeId');
    const entry = registry.getById(id);
    if (!entry) return c.json({ error: 'unknown demo' }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = PositionBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid position body', issues: parsed.error.issues }, 400);
    }
    const { x, y } = parsed.data;

    const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
    if (!existsSync(fullPath)) {
      return c.json({ error: `Demo file not found: ${fullPath}` }, 404);
    }

    type Outcome =
      | { kind: 'ok' }
      | { kind: 'badJson'; message: string }
      | { kind: 'badSchema'; issues: unknown }
      | { kind: 'unknownNode' }
      | { kind: 'writeFailed'; message: string };

    const result = await withDemoWriteLock<Outcome>(id, async () => {
      let raw: unknown;
      try {
        raw = await Bun.file(fullPath).json();
      } catch (err) {
        return {
          kind: 'badJson',
          message: err instanceof Error ? err.message : String(err),
        };
      }
      const demoParsed = DemoSchema.safeParse(raw);
      if (!demoParsed.success) return { kind: 'badSchema', issues: demoParsed.error.issues };

      // Mutate the *raw* parsed JSON so we preserve every author-written
      // field (including any v2 fields the schema doesn't know about yet).
      const obj = raw as { nodes: Array<{ id: string; position: { x: number; y: number } }> };
      const onDiskNode = obj.nodes.find((n) => n.id === nodeId);
      if (!onDiskNode) return { kind: 'unknownNode' };
      onDiskNode.position = { x, y };

      try {
        writeFileAtomic(fullPath, `${JSON.stringify(obj, null, 2)}\n`);
      } catch (err) {
        return {
          kind: 'writeFailed',
          message: err instanceof Error ? err.message : String(err),
        };
      }
      return { kind: 'ok' };
    });

    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true, position: { x, y } });
      case 'badJson':
        return c.json({ error: `Demo file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Demo failed schema validation', issues: result.issues }, 400);
      case 'unknownNode':
        return c.json({ error: `Unknown nodeId: ${nodeId}` }, 404);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  api.post('/emit', async (c) => {
    if (!events) return c.json({ error: 'events not enabled' }, 500);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }

    const parsed = EmitBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid emit body', issues: parsed.error.issues }, 400);
    }

    const { demoId, nodeId, status, runId, payload } = parsed.data;
    if (!registry.getById(demoId)) {
      return c.json({ error: `Unknown demoId: ${demoId}` }, 404);
    }

    const extras =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const eventPayload: Record<string, unknown> = { nodeId, ...extras };
    if (runId !== undefined) eventPayload.runId = runId;

    events.broadcast({
      type: EMIT_STATUS_TO_EVENT[status],
      demoId,
      payload: eventPayload,
    });

    return c.json({ ok: true });
  });

  api.get('/events', (c) => {
    const demoId = c.req.query('demoId');
    if (!demoId) return c.json({ error: 'demoId query param required' }, 400);
    if (!registry.getById(demoId)) return c.json({ error: 'unknown demoId' }, 404);
    if (!events) return c.json({ error: 'events not enabled' }, 500);

    return streamSSE(c, async (stream) => {
      let active = true;
      const queue: Array<{ event: string; data: string }> = [];
      let resume: (() => void) | null = null;

      const wake = () => {
        if (resume) {
          const r = resume;
          resume = null;
          r();
        }
      };

      const unsubscribe = events.subscribe(demoId, (e) => {
        queue.push({ event: e.type, data: JSON.stringify({ ts: e.ts, ...(e.payload as object) }) });
        wake();
      });

      stream.onAbort(() => {
        active = false;
        unsubscribe();
        wake();
      });

      // Initial 'hello' so reconnecting clients can confirm the stream is open
      // and trigger a re-fetch on the frontend.
      await stream.writeSSE({
        event: 'hello',
        data: JSON.stringify({ demoId, ts: Date.now() }),
      });

      try {
        while (active) {
          while (queue.length > 0) {
            const next = queue.shift();
            if (!next) break;
            await stream.writeSSE(next);
          }
          if (!active) break;
          await new Promise<void>((r) => {
            resume = r;
          });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  return api;
}
