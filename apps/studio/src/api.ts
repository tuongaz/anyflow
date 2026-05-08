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
    borderSize: z.number().positive().optional(),
    borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    fontSize: z.number().positive().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    shape: z.enum(['rectangle', 'ellipse', 'sticky', 'text']).optional(),
  })
  .strict();
type NodePatchBody = z.infer<typeof NodePatchBodySchema>;

// Partial connector update body. Strict at the top level so client typos
// surface as 400. Per-kind invariants (e.g. kind='event' requires eventName)
// are enforced post-merge by re-parsing the whole demo through DemoSchema.
const ConnectorKindSchema = z.enum(['http', 'event', 'queue', 'default']);
const ConnectorPatchBodySchema = z
  .object({
    label: z.string().optional(),
    style: z.enum(['solid', 'dashed', 'dotted']).optional(),
    color: ColorTokenSchema.optional(),
    direction: z.enum(['forward', 'backward', 'both']).optional(),
    borderSize: z.number().positive().optional(),
    kind: ConnectorKindSchema.optional(),
    eventName: z.string().optional(),
    queueName: z.string().optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    url: z.string().optional(),
    // Reconnect: drag an edge endpoint onto another node's handle. The
    // post-merge DemoSchema parse rejects dangling references, so we don't
    // need a referential check here.
    source: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    // Reconnect to a different handle on the same (or a new) node. Handle ids
    // identify which side (top/right/bottom/left) of the node the connector
    // attaches to (US-013).
    sourceHandle: z.string().min(1).optional(),
    targetHandle: z.string().min(1).optional(),
  })
  .strict();
type ConnectorPatchBody = z.infer<typeof ConnectorPatchBodySchema>;

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
  'borderSize',
  'borderStyle',
  'fontSize',
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

// Reorder a node within `demo.nodes[]`. The four ops mirror the typical
// "send backward / bring forward / to back / to front" actions; `toIndex`
// pins the node back to a captured absolute index so undo for `forward` /
// `backward` from the middle is faithful even under concurrent edits.
const ReorderBodySchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('forward') }),
  z.object({ op: z.literal('backward') }),
  z.object({ op: z.literal('toFront') }),
  z.object({ op: z.literal('toBack') }),
  z.object({ op: z.literal('toIndex'), index: z.number().int().nonnegative() }),
]);
type ReorderBody = z.infer<typeof ReorderBodySchema>;

const reorderNodes = (
  nodes: Array<Record<string, unknown>>,
  fromIdx: number,
  body: ReorderBody,
): boolean => {
  const len = nodes.length;
  switch (body.op) {
    case 'forward': {
      if (fromIdx >= len - 1) return false;
      const tmp = nodes[fromIdx];
      const next = nodes[fromIdx + 1];
      if (tmp === undefined || next === undefined) return false;
      nodes[fromIdx] = next;
      nodes[fromIdx + 1] = tmp;
      return true;
    }
    case 'backward': {
      if (fromIdx <= 0) return false;
      const tmp = nodes[fromIdx];
      const prev = nodes[fromIdx - 1];
      if (tmp === undefined || prev === undefined) return false;
      nodes[fromIdx] = prev;
      nodes[fromIdx - 1] = tmp;
      return true;
    }
    case 'toFront': {
      if (fromIdx === len - 1) return false;
      const [removed] = nodes.splice(fromIdx, 1);
      if (removed === undefined) return false;
      nodes.push(removed);
      return true;
    }
    case 'toBack': {
      if (fromIdx === 0) return false;
      const [removed] = nodes.splice(fromIdx, 1);
      if (removed === undefined) return false;
      nodes.unshift(removed);
      return true;
    }
    case 'toIndex': {
      const target = Math.min(Math.max(body.index, 0), len - 1);
      if (target === fromIdx) return false;
      const [removed] = nodes.splice(fromIdx, 1);
      if (removed === undefined) return false;
      nodes.splice(target, 0, removed);
      return true;
    }
  }
};

// Kind-specific connector fields. When `kind` changes via PATCH, these are
// dropped first so the resulting connector doesn't carry phantom payloads
// from the previous kind (e.g. an event→default change leaving eventName
// behind, which DemoSchema would silently strip on parse but leave on disk).
const CONNECTOR_KIND_FIELDS = ['method', 'url', 'eventName', 'queueName'] as const;

const mergeConnectorUpdates = (
  conn: Record<string, unknown>,
  updates: ConnectorPatchBody,
): void => {
  if (updates.kind !== undefined && updates.kind !== conn.kind) {
    for (const key of CONNECTOR_KIND_FIELDS) {
      delete conn[key];
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      conn[key] = value;
    }
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

  // PATCH the z-order position of a single node within demo.nodes[]. React
  // Flow's painter renders nodes in array order, so moving a node to a later
  // index brings it visually forward (later nodes paint over earlier ones).
  // Five ops are supported: forward / backward (single-step swap), toFront /
  // toBack (remove + push/unshift), and toIndex (pin to an absolute index)
  // which the undo path uses to faithfully revert forward/backward gestures
  // even if the array changed between the original op and the undo.
  api.patch('/demos/:id/nodes/:nodeId/order', async (c) => {
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
    const parsed = ReorderBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid reorder body', issues: parsed.error.issues }, 400);
    }
    const reorderOp = parsed.data;

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
      const fromIdx = obj.nodes.findIndex((n) => n.id === nodeId);
      if (fromIdx < 0) return { kind: 'unknownNode' };

      // No-op reorders (e.g. forward on the topmost node) succeed silently —
      // skip the write so we don't trigger a watcher echo for nothing.
      const moved = reorderNodes(obj.nodes, fromIdx, reorderOp);
      if (!moved) return { kind: 'ok' };

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

  // PATCH a single connector — partial update of label/style/color/direction
  // and (optionally) kind + per-kind payload fields. When `kind` changes,
  // stale kind-specific fields are dropped before the merge. The whole demo
  // is re-validated through DemoSchema before commit so the discriminated
  // union catches missing-required-fields (e.g. kind='event' without
  // eventName) and the superRefine still gates source/target referential
  // integrity.
  api.patch('/demos/:id/connectors/:connId', async (c) => {
    const id = c.req.param('id');
    const connId = c.req.param('connId');
    const entry = registry.getById(id);
    if (!entry) return c.json({ error: 'unknown demo' }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = ConnectorPatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid connector patch body', issues: parsed.error.issues }, 400);
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
      | { kind: 'unknownConnector' }
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

      const obj = raw as { connectors: Array<Record<string, unknown>> };
      const onDiskConn = obj.connectors.find((cn) => cn.id === connId);
      if (!onDiskConn) return { kind: 'unknownConnector' };

      mergeConnectorUpdates(onDiskConn, updates);

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
      case 'unknownConnector':
        return c.json({ error: `Unknown connectorId: ${connId}` }, 404);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  // POST a new connector. Body is the connector payload; `id` is auto-generated
  // server-side if absent and `kind` defaults to 'default' (the no-semantics
  // user-drawn variant). Source/target referential integrity is enforced by
  // DemoSchema's superRefine on the post-mutation parse.
  api.post('/demos/:id/connectors', async (c) => {
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
    const newConn = { ...(body as Record<string, unknown>) };
    if (typeof newConn.id !== 'string' || newConn.id.length === 0) {
      newConn.id = `conn-${crypto.randomUUID()}`;
    }
    if (typeof newConn.kind !== 'string' || newConn.kind.length === 0) {
      newConn.kind = 'default';
    }
    const newId = newConn.id as string;

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

      const obj = raw as { connectors: Array<Record<string, unknown>> };
      obj.connectors.push(newConn);

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

  // DELETE a connector. Just removes the entry from demo.connectors — node
  // deletion is what cascades, not connector deletion.
  api.delete('/demos/:id/connectors/:connId', async (c) => {
    const id = c.req.param('id');
    const connId = c.req.param('connId');
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
      | { kind: 'unknownConnector' }
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

      const obj = raw as { connectors: Array<{ id: string }> };
      const idx = obj.connectors.findIndex((cn) => cn.id === connId);
      if (idx < 0) return { kind: 'unknownConnector' };
      obj.connectors.splice(idx, 1);

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
      case 'unknownConnector':
        return c.json({ error: `Unknown connectorId: ${connId}` }, 404);
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
