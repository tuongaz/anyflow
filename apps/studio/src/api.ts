import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  AssembleRequestSchema,
  ProposeScopeRequestSchema,
  ValidateRequestSchema,
  assembleDemo,
  proposeScope,
  validateDemo,
} from './diagram.ts';
import type { EventBus } from './events.ts';
import {
  ConnectorPatchBodySchema,
  CreateProjectBodySchema,
  NodePatchBodySchema,
  PositionBodySchema,
  RegisterBodySchema,
  ReorderBodySchema,
  addConnectorImpl,
  addNodeImpl,
  createProjectImpl,
  deleteConnectorImpl,
  deleteDemoImpl,
  deleteNodeImpl,
  getDemoImpl,
  listDemosImpl,
  moveNodeImpl,
  patchConnectorImpl,
  patchNodeImpl,
  registerDemoImpl,
  reorderNodeImpl,
  resolveDemoPath,
} from './operations.ts';
import { fetchDynamicDetail, runPlay } from './proxy.ts';
import type { Registry } from './registry.ts';
import { DemoSchema } from './schema.ts';
import type { DemoWatcher } from './watcher.ts';

const EmitBodySchema = z.object({
  demoId: z.string().min(1),
  nodeId: z.string().min(1),
  status: z.enum(['running', 'done', 'error']),
  runId: z.string().optional(),
  payload: z.unknown().optional(),
});

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

    const result = await registerDemoImpl({ registry, watcher }, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json(result.data);
      case 'fileNotFound':
        return c.json({ error: `Demo file not found: ${result.path}` }, 400);
      case 'badJson':
        return c.json({ error: 'Demo file is not valid JSON', detail: result.detail }, 400);
      case 'badSchema':
        return c.json({ error: 'Demo file failed schema validation', issues: result.issues }, 400);
      case 'sdkWriteFailed':
        return c.json(
          {
            error: `Failed to write SDK helper: ${result.message}`,
            id: result.id,
            slug: result.slug,
          },
          500,
        );
    }
  });

  // POST /api/demos/validate — dry-run validation. The skill's diagram
  // pipeline calls this between assemble and register to decide whether to
  // rewire. Runs the Zod schema, the soft node cap, and the tier playability
  // check. Filesystem-bound checks (harness coverage, event emitter index)
  // stay in the skill since the studio doesn't see the user's $TARGET.
  api.post('/demos/validate', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = ValidateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid validate body', issues: parsed.error.issues }, 400);
    }
    return c.json(validateDemo(parsed.data));
  });

  // POST /api/diagram/propose-scope — Phase 2 helper. The skill POSTs the
  // scan-result.json shape and gets back ranked entry-point candidates.
  // Pure compute; skill writes the response to intermediate/entry-candidates.json.
  api.post('/diagram/propose-scope', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = ProposeScopeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid propose-scope body', issues: parsed.error.issues }, 400);
    }
    return c.json(proposeScope(parsed.data));
  });

  // POST /api/diagram/assemble — Phase 7a. The skill POSTs wiring + layout
  // and gets back the assembled demo (IDs normalized, dupes dropped, dangling
  // connectors removed, positions snapped to a 24px grid). Pure compute; the
  // skill writes the response to $TARGET/.anydemo/demo.json. No schema
  // validation here — call /demos/validate for that.
  api.post('/diagram/assemble', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = AssembleRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid assemble body', issues: parsed.error.issues }, 400);
    }
    return c.json(assembleDemo(parsed.data));
  });

  // POST /api/projects — UI-driven "Create new project" flow (US-020). Two
  // branches based on whether the target folder already has an AnyDemo
  // project set up at `<folderPath>/.anydemo/demo.json`:
  //   1. Existing setup: read + validate the on-disk demo and register it
  //      as-is (no overwrite, no scaffolding). The user-supplied `name`
  //      becomes the registry display name; the on-disk demo's `name` is
  //      preserved on disk.
  //   2. Fresh scaffold: mkdir -p the folder + .anydemo/, write a default
  //      scaffold demo.json keyed off `name`, and run the same SDK-emit
  //      helper write the CLI register flow uses (a no-op for an empty
  //      scaffold, but kept for parity).
  api.post('/projects', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }

    const parsed = CreateProjectBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid create project body', issues: parsed.error.issues }, 400);
    }

    const result = await createProjectImpl({ registry, watcher }, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json(result.data);
      case 'invalidPath':
        return c.json({ error: 'folderPath must be an absolute filesystem path' }, 400);
      case 'badJson':
        return c.json({ error: `Existing demo file is not valid JSON: ${result.detail}` }, 400);
      case 'badSchema':
        return c.json(
          { error: 'Existing demo file failed schema validation', issues: result.issues },
          400,
        );
      case 'scaffoldFailed':
        return c.json(
          { error: `Failed to scaffold project at ${parsed.data.folderPath}: ${result.message}` },
          500,
        );
      case 'sdkWriteFailed':
        return c.json({ error: `Failed to write SDK helper: ${result.message}` }, 500);
    }
  });

  api.get('/demos', (c) => {
    const result = listDemosImpl({ registry });
    return c.json(result.data);
  });

  api.get('/demos/:id', async (c) => {
    const result = await getDemoImpl({ registry, watcher }, c.req.param('id'));
    switch (result.kind) {
      case 'ok':
        return c.json(result.data);
      case 'notFound':
        return c.json({ error: 'not found' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Demo file not found: ${result.path}` }, 404);
    }
  });

  api.delete('/demos/:id', (c) => {
    const result = deleteDemoImpl({ registry, watcher }, c.req.param('id'));
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true });
      case 'notFound':
        return c.json({ ok: false, error: 'not found' }, 404);
    }
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
    if (
      node.type === 'shapeNode' ||
      node.type === 'imageNode' ||
      node.type === 'iconNode' ||
      node.type === 'group' ||
      !node.data.playAction
    ) {
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

  // POST /api/demos/:id/reset — fires the demo's `resetAction` (if declared)
  // so the running app can wipe its in-memory state, then broadcasts a
  // `demo:reload` event so all connected canvases re-fetch the demo from disk.
  // The reload broadcast happens unconditionally whenever the demo loads — a
  // failed resetAction (network error or status>=400) surfaces as a 502 to the
  // caller but does NOT suppress the reload, so the canvas state still
  // refreshes. URL handling matches `playAction`: the action's `url` is fetched
  // verbatim with no studio-side resolution.
  api.post('/demos/:id/reset', async (c) => {
    const id = c.req.param('id');
    const entry = registry.getById(id);
    if (!entry) return c.json({ error: 'unknown demo' }, 404);
    if (!events) return c.json({ error: 'events not enabled' }, 500);

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

    const resetAction = parsed.data.resetAction;
    let calledResetAction = false;
    let resetActionError: string | undefined;

    if (resetAction) {
      calledResetAction = true;
      try {
        const init: RequestInit = {
          method: resetAction.method,
          headers: { 'content-type': 'application/json' },
        };
        if (resetAction.body !== undefined) {
          init.body = JSON.stringify(resetAction.body);
        }
        const upstream = await fetch(resetAction.url, init);
        if (upstream.status >= 400) {
          let upstreamBody = '';
          try {
            upstreamBody = await upstream.text();
          } catch {
            // best-effort body read for the error message
          }
          const trimmed = upstreamBody.trim().slice(0, 200);
          resetActionError = trimmed
            ? `Reset action returned ${upstream.status}: ${trimmed}`
            : `Reset action returned ${upstream.status}`;
        }
      } catch (err) {
        resetActionError = err instanceof Error ? err.message : String(err);
      }
    }

    // Broadcast unconditionally — even when resetAction failed, the canvas
    // should still refresh from disk in case the user just edited the file.
    events.broadcast({
      type: 'demo:reload',
      demoId: id,
      payload: {},
    });

    if (resetActionError) {
      return c.json({ error: resetActionError, calledResetAction }, 502);
    }
    return c.json({ ok: true, calledResetAction });
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

    const dynamicSource =
      node.type === 'shapeNode' ||
      node.type === 'imageNode' ||
      node.type === 'iconNode' ||
      node.type === 'group'
        ? undefined
        : node.data.detail?.dynamicSource;
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

    const result = await moveNodeImpl({ registry, watcher }, id, nodeId, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true, position: result.data.position });
      case 'demoNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Demo file not found: ${result.path}` }, 404);
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

    const result = await reorderNodeImpl({ registry, watcher }, id, nodeId, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true });
      case 'demoNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Demo file not found: ${result.path}` }, 404);
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

    const result = await patchNodeImpl({ registry, watcher }, id, nodeId, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true });
      case 'demoNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Demo file not found: ${result.path}` }, 404);
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

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Body must be an object' }, 400);
    }

    const result = await addNodeImpl({ registry, watcher }, id, body as Record<string, unknown>);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true, id: result.data.id });
      case 'demoNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Demo file not found: ${result.path}` }, 404);
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

    const result = await deleteNodeImpl({ registry, watcher }, id, nodeId);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true });
      case 'demoNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Demo file not found: ${result.path}` }, 404);
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

    const result = await patchConnectorImpl({ registry, watcher }, id, connId, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true });
      case 'demoNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Demo file not found: ${result.path}` }, 404);
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

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Body must be an object' }, 400);
    }

    const result = await addConnectorImpl(
      { registry, watcher },
      id,
      body as Record<string, unknown>,
    );
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true, id: result.data.id });
      case 'demoNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Demo file not found: ${result.path}` }, 404);
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

    const result = await deleteConnectorImpl({ registry, watcher }, id, connId);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true });
      case 'demoNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Demo file not found: ${result.path}` }, 404);
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
