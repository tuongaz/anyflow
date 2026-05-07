import { existsSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { EventBus } from './events.ts';
import { fetchDynamicDetail, runPlay } from './proxy.ts';
import type { Registry } from './registry.ts';
import { ColorTokenSchema, DemoSchema } from './schema.ts';
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

// Partial node update body. Top-level `position` lands on node.position; every
// other key lands inside node.data. Final validity is enforced by re-parsing
// the whole demo through DemoSchema after the merge — this body schema just
// rejects unknown top-level keys to catch typos. `detail` is loose here so
// senders can swap the entire detail object; DemoSchema validates the shape
// before we write.
const NodePatchBodySchema = z
  .object({
    position: PositionBodySchema.optional(),
    label: z.string().optional(),
    detail: z.unknown().optional(),
    borderColor: ColorTokenSchema.optional(),
    backgroundColor: ColorTokenSchema.optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    shape: z.enum(['rectangle', 'ellipse', 'sticky']).optional(),
  })
  .strict();
type NodePatchBody = z.infer<typeof NodePatchBodySchema>;

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

// Apply a partial PATCH body to a raw on-disk node. `position` lives at the
// node root; every other key lives inside `data`. We mutate the raw parsed
// JSON directly so unknown forward-compat fields the schema doesn't yet
// recognize survive the round-trip untouched.
const NODE_DATA_PATCH_KEYS = [
  'label',
  'detail',
  'borderColor',
  'backgroundColor',
  'width',
  'height',
  'shape',
] as const satisfies ReadonlyArray<keyof NodePatchBody>;

const mergeNodeUpdates = (node: Record<string, unknown>, updates: NodePatchBody): void => {
  if (updates.position !== undefined) {
    node.position = updates.position;
  }
  const dataAny = node.data;
  const data: Record<string, unknown> =
    dataAny && typeof dataAny === 'object' && !Array.isArray(dataAny)
      ? (dataAny as Record<string, unknown>)
      : {};
  let touchedData = false;
  for (const key of NODE_DATA_PATCH_KEYS) {
    if (updates[key] !== undefined) {
      data[key] = updates[key];
      touchedData = true;
    }
  }
  if (touchedData) {
    node.data = data;
  }
};

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

  // PATCH a single node — partial update of position, label, detail, visual
  // fields, or shapeNode-only fields. Every UI-driven node edit (other than
  // the high-frequency drag fast-path above) flows through here. The mutation
  // is performed against the raw parsed JSON (so unknown v2 fields the schema
  // doesn't yet recognize survive round-trips) and the WHOLE resulting demo
  // is re-validated through DemoSchema before commit, preventing partial
  // writes from breaking invariants like the connector→node superRefine.
  api.patch('/demos/:id/nodes/:nodeId', async (c) => {
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
    const parsed = NodePatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid node patch body', issues: parsed.error.issues }, 400);
    }
    const updates = parsed.data;

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

      const obj = raw as { nodes: Array<Record<string, unknown>> };
      const onDiskNode = obj.nodes.find((n) => n.id === nodeId);
      if (!onDiskNode) return { kind: 'unknownNode' };

      mergeNodeUpdates(onDiskNode, updates);

      const finalParse = DemoSchema.safeParse(raw);
      if (!finalParse.success) return { kind: 'badSchema', issues: finalParse.error.issues };

      try {
        writeFileAtomic(fullPath, `${JSON.stringify(raw, null, 2)}\n`);
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
        return c.json({ ok: true });
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

  // POST a new node into the demo. Body is the node payload (id auto-generated
  // server-side if absent). Atomicity + final-DemoSchema validation match the
  // PATCH path above, so a malformed node never produces a half-written file.
  api.post('/demos/:id/nodes', async (c) => {
    const id = c.req.param('id');
    const entry = registry.getById(id);
    if (!entry) return c.json({ error: 'unknown demo' }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Body must be an object' }, 400);
    }
    const newNode = { ...(body as Record<string, unknown>) };
    if (typeof newNode.id !== 'string' || newNode.id.length === 0) {
      newNode.id = `node-${crypto.randomUUID()}`;
    }
    const newId = newNode.id as string;

    const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
    if (!existsSync(fullPath)) {
      return c.json({ error: `Demo file not found: ${fullPath}` }, 404);
    }

    type Outcome =
      | { kind: 'ok' }
      | { kind: 'badJson'; message: string }
      | { kind: 'badSchema'; issues: unknown }
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

      const obj = raw as { nodes: Array<Record<string, unknown>> };
      obj.nodes.push(newNode);

      const finalParse = DemoSchema.safeParse(raw);
      if (!finalParse.success) return { kind: 'badSchema', issues: finalParse.error.issues };

      try {
        writeFileAtomic(fullPath, `${JSON.stringify(raw, null, 2)}\n`);
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
        return c.json({ ok: true, id: newId });
      case 'badJson':
        return c.json({ error: `Demo file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Demo failed schema validation', issues: result.issues }, 400);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  // DELETE a node and cascade-remove every connector with source === nodeId or
  // target === nodeId in the same atomic write. Final-DemoSchema validation
  // is still run after the mutation — connector cascade closure means it
  // should always pass, but the check makes the failure mode honest if the
  // file had a pre-existing schema violation we'd otherwise paper over.
  api.delete('/demos/:id/nodes/:nodeId', async (c) => {
    const id = c.req.param('id');
    const nodeId = c.req.param('nodeId');
    const entry = registry.getById(id);
    if (!entry) return c.json({ error: 'unknown demo' }, 404);

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

      const obj = raw as {
        nodes: Array<{ id: string }>;
        connectors: Array<{ source: string; target: string }>;
      };
      const idx = obj.nodes.findIndex((n) => n.id === nodeId);
      if (idx < 0) return { kind: 'unknownNode' };
      obj.nodes.splice(idx, 1);
      obj.connectors = obj.connectors.filter((cn) => cn.source !== nodeId && cn.target !== nodeId);

      const finalParse = DemoSchema.safeParse(raw);
      if (!finalParse.success) return { kind: 'badSchema', issues: finalParse.error.issues };

      try {
        writeFileAtomic(fullPath, `${JSON.stringify(raw, null, 2)}\n`);
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
        return c.json({ ok: true });
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
