// Shared inner helpers that REST handlers in api.ts and MCP tool handlers in
// mcp.ts both call. Each helper returns an Outcome discriminated union so the
// caller layer can translate it into its native response shape (HTTP status
// vs. MCP CallToolResult) without duplicating any of the business logic.
//
// Helpers extracted in US-002: discovery + project setup (5 tools).
// Helpers extracted in US-003: node lifecycle (add/delete/move/reorder).
// Future stories add patch_node + connector helpers alongside these.

import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { type ZodIssue, z } from 'zod';
import type { Registry } from './registry.ts';
import {
  ColorTokenSchema,
  type Demo,
  DemoSchema,
  SourceHandleIdSchema,
  TargetHandleIdSchema,
} from './schema.ts';
import { writeSdkEmitIfNeeded } from './sdk-writer.ts';
import type { DemoSnapshot, DemoWatcher } from './watcher.ts';

const DEFAULT_DEMO_RELATIVE_PATH = '.anydemo/demo.json';

export const RegisterBodySchema = z.object({
  name: z.string().min(1).optional(),
  repoPath: z.string().min(1),
  demoPath: z.string().min(1),
});
export type RegisterBody = z.infer<typeof RegisterBodySchema>;

export const CreateProjectBodySchema = z.object({
  name: z.string().min(1),
  folderPath: z.string().min(1),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

export const PositionBodySchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type PositionBody = z.infer<typeof PositionBodySchema>;

// Reorder a node within `demo.nodes[]`. The four ops mirror the typical
// "send backward / bring forward / to back / to front" actions; `toIndex`
// pins the node back to a captured absolute index so undo for `forward` /
// `backward` from the middle is faithful even under concurrent edits.
export const ReorderBodySchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('forward') }),
  z.object({ op: z.literal('backward') }),
  z.object({ op: z.literal('toFront') }),
  z.object({ op: z.literal('toBack') }),
  z.object({ op: z.literal('toIndex'), index: z.number().int().nonnegative() }),
]);
export type ReorderBody = z.infer<typeof ReorderBodySchema>;

// Partial node update body. Top-level `position` lands on node.position; every
// other key lands inside node.data. Final validity is enforced by re-parsing
// the whole demo through DemoSchema after the merge — this body schema just
// rejects unknown top-level keys to catch typos. `detail` is loose here so
// senders can swap the entire detail object; DemoSchema validates the shape
// before we write.
export const NodePatchBodySchema = z
  .object({
    position: PositionBodySchema.optional(),
    label: z.string().optional(),
    detail: z.unknown().optional(),
    borderColor: ColorTokenSchema.optional(),
    backgroundColor: ColorTokenSchema.optional(),
    borderSize: z.number().positive().optional(),
    borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    fontSize: z.number().positive().optional(),
    cornerRadius: z.number().min(0).optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    shape: z.enum(['rectangle', 'ellipse', 'sticky', 'text']).optional(),
    // iconNode-only: stroke color token. Lands at data.color; DemoSchema's
    // post-merge reparse gates that this is only valid on an iconNode.
    color: ColorTokenSchema.optional(),
    // iconNode-only: glyph stroke width. Lands at data.strokeWidth; the
    // post-merge reparse gates the [0.5, 4] bound and arm validity.
    strokeWidth: z.number().min(0.5).max(4).optional(),
    // iconNode-only: accessible alt text for the icon. Lands at data.alt.
    alt: z.string().optional(),
    // iconNode-only: kebab-case Lucide icon name. Lands at data.icon. The
    // post-merge reparse enforces the schema's `.min(1)` non-empty rule and
    // gates that this lands only on an iconNode.
    icon: z.string().min(1).optional(),
  })
  .strict();
export type NodePatchBody = z.infer<typeof NodePatchBodySchema>;

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
  'cornerRadius',
  'width',
  'height',
  'shape',
  'color',
  'strokeWidth',
  'alt',
  'icon',
] as const satisfies ReadonlyArray<keyof NodePatchBody>;

export const mergeNodeUpdates = (node: Record<string, unknown>, updates: NodePatchBody): void => {
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

export interface OperationsDeps {
  registry: Registry;
  watcher?: DemoWatcher;
}

export interface DemoListItem {
  id: string;
  slug: string;
  name: string;
  repoPath: string;
  lastModified: number;
  valid: boolean;
}

export interface DemoGetResponse {
  id: string;
  slug: string;
  name: string;
  filePath: string;
  demo: Demo | null;
  valid: boolean;
  error: string | null;
}

export interface RegisterDemoSuccess {
  id: string;
  slug: string;
  sdk: { outcome: 'written' | 'present' | 'skipped'; filePath: string | null };
}

export interface CreateProjectSuccess {
  id: string;
  slug: string;
  scaffolded: boolean;
}

export type ListDemosOutcome = { kind: 'ok'; data: DemoListItem[] };

export type GetDemoOutcome =
  | { kind: 'ok'; data: DemoGetResponse }
  | { kind: 'notFound' }
  | { kind: 'fileNotFound'; path: string };

export type RegisterDemoOutcome =
  | { kind: 'ok'; data: RegisterDemoSuccess }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; detail: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'sdkWriteFailed'; id: string; slug: string; message: string };

export type DeleteDemoOutcome = { kind: 'ok' } | { kind: 'notFound' };

export type CreateProjectOutcome =
  | { kind: 'ok'; data: CreateProjectSuccess }
  | { kind: 'invalidPath' }
  | { kind: 'badJson'; detail: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'scaffoldFailed'; message: string }
  | { kind: 'sdkWriteFailed'; message: string };

// Outcomes for the four node-lifecycle helpers. Every variant lines up with
// an existing REST error response so api.ts can translate them back to the
// same status code + JSON body it used to emit directly.
export type AddNodeOutcome =
  | { kind: 'ok'; data: { id: string } }
  | { kind: 'demoNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'writeFailed'; message: string };

export type DeleteNodeOutcome =
  | { kind: 'ok' }
  | { kind: 'demoNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'unknownNode' }
  | { kind: 'writeFailed'; message: string };

export type MoveNodeOutcome =
  | { kind: 'ok'; data: { position: PositionBody } }
  | { kind: 'demoNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'unknownNode' }
  | { kind: 'writeFailed'; message: string };

export type ReorderNodeOutcome =
  | { kind: 'ok' }
  | { kind: 'demoNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'unknownNode' }
  | { kind: 'writeFailed'; message: string };

export type PatchNodeOutcome =
  | { kind: 'ok' }
  | { kind: 'demoNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'unknownNode' }
  | { kind: 'writeFailed'; message: string };

// Partial connector update body. Strict at the top level so client typos
// surface as 400. Per-kind invariants (e.g. kind='event' requires eventName)
// are enforced post-merge by re-parsing the whole demo through DemoSchema.
const ConnectorKindSchema = z.enum(['http', 'event', 'queue', 'default']);
export const ConnectorPatchBodySchema = z
  .object({
    label: z.string().optional(),
    style: z.enum(['solid', 'dashed', 'dotted']).optional(),
    color: ColorTokenSchema.optional(),
    direction: z.enum(['forward', 'backward', 'both']).optional(),
    borderSize: z.number().positive().optional(),
    path: z.enum(['curve', 'step']).optional(),
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
    // attaches to (US-013); the role is locked — `sourceHandle` must be a
    // source-side id, `targetHandle` must be a target-side id (US-022).
    // Nullable so a body-drop reconnect (US-025) can clear a previously-pinned
    // handle id by sending `null`; mergeConnectorUpdates deletes the field
    // when the value is null.
    sourceHandle: SourceHandleIdSchema.nullable().optional(),
    targetHandle: TargetHandleIdSchema.nullable().optional(),
    // US-021: auto-pick flags. Originally written by the picker on body-drop
    // create / reconnect. US-025 keeps the schema shape but redefines the
    // semantics: `true`/absent means "render floating" against the line
    // through the two node centers; `false` means "render pinned to the
    // stored handle id".
    sourceHandleAutoPicked: z.boolean().optional(),
    targetHandleAutoPicked: z.boolean().optional(),
  })
  .strict();
export type ConnectorPatchBody = z.infer<typeof ConnectorPatchBodySchema>;

// Kind-specific connector fields. When `kind` changes via PATCH, these are
// dropped first so the resulting connector doesn't carry phantom payloads
// from the previous kind (e.g. an event→default change leaving eventName
// behind, which DemoSchema would silently strip on parse but leave on disk).
const CONNECTOR_KIND_FIELDS = ['method', 'url', 'eventName', 'queueName'] as const;

export const mergeConnectorUpdates = (
  conn: Record<string, unknown>,
  updates: ConnectorPatchBody,
): void => {
  if (updates.kind !== undefined && updates.kind !== conn.kind) {
    for (const key of CONNECTOR_KIND_FIELDS) {
      delete conn[key];
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    // US-025: explicit null in the patch body means "clear this field on
    // disk". Used by reconnect-to-body to drop a previously-pinned handle
    // id when the endpoint flips back to floating.
    if (value === null) {
      delete conn[key];
      continue;
    }
    conn[key] = value;
  }
};

export type AddConnectorOutcome =
  | { kind: 'ok'; data: { id: string } }
  | { kind: 'demoNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'writeFailed'; message: string };

export type PatchConnectorOutcome =
  | { kind: 'ok' }
  | { kind: 'demoNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'unknownConnector' }
  | { kind: 'writeFailed'; message: string };

export type DeleteConnectorOutcome =
  | { kind: 'ok' }
  | { kind: 'demoNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'unknownConnector' }
  | { kind: 'writeFailed'; message: string };

export const resolveDemoPath = (repoPath: string, demoPath: string): string =>
  isAbsolute(demoPath) ? demoPath : join(repoPath, demoPath);

// Per-demo serialization: read-modify-write of the demo file isn't atomic
// across multiple PATCHes, so two concurrent drags would race (later writer's
// older read clobbers the earlier writer's update). We chain writes per
// demoId so the read+write sequence is effectively serialized.
const demoWriteChains = new Map<string, Promise<unknown>>();
export const withDemoWriteLock = <T>(demoId: string, fn: () => Promise<T>): Promise<T> => {
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
export const writeFileAtomic = (filePath: string, content: string): void => {
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

export const reorderNodes = (
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

export function listDemosImpl(deps: OperationsDeps): ListDemosOutcome {
  const data = deps.registry.list().map((e) => {
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
  });
  return { kind: 'ok', data };
}

export async function getDemoImpl(deps: OperationsDeps, demoId: string): Promise<GetDemoOutcome> {
  const { registry, watcher } = deps;
  const entry = registry.getById(demoId);
  if (!entry) return { kind: 'notFound' };

  const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
  const snap = watcher?.snapshot(demoId) ?? watcher?.reparse(demoId) ?? null;

  const buildResponse = (s: DemoSnapshot): DemoGetResponse => ({
    id: entry.id,
    slug: entry.slug,
    name: entry.name,
    filePath: fullPath,
    demo: s.demo,
    valid: s.valid,
    error: s.valid ? null : s.error,
  });

  if (snap) return { kind: 'ok', data: buildResponse(snap) };

  // No watcher available — fall back to a synchronous read so MCP / CLI
  // callers without a long-lived watcher still get a current snapshot.
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  let raw: unknown;
  try {
    raw = await Bun.file(fullPath).json();
  } catch (err) {
    return {
      kind: 'ok',
      data: buildResponse({
        demo: null,
        valid: false,
        error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        filePath: fullPath,
        parsedAt: Date.now(),
      }),
    };
  }
  const parsed = DemoSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: 'ok',
      data: buildResponse({
        demo: null,
        valid: false,
        error: parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; '),
        filePath: fullPath,
        parsedAt: Date.now(),
      }),
    };
  }
  return {
    kind: 'ok',
    data: buildResponse({
      demo: parsed.data,
      valid: true,
      error: null,
      filePath: fullPath,
      parsedAt: Date.now(),
    }),
  };
}

export async function registerDemoImpl(
  deps: OperationsDeps,
  body: RegisterBody,
): Promise<RegisterDemoOutcome> {
  const { registry, watcher } = deps;
  const { repoPath, demoPath } = body;
  const fullPath = resolveDemoPath(repoPath, demoPath);

  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  let demo: unknown;
  try {
    demo = await Bun.file(fullPath).json();
  } catch (err) {
    // REST uses String(err) here (preserves "SyntaxError: ..." prefix) —
    // keep byte-identical so api.test.ts assertions stay green.
    return { kind: 'badJson', detail: String(err) };
  }

  const demoParse = DemoSchema.safeParse(demo);
  if (!demoParse.success) return { kind: 'badSchema', issues: demoParse.error.issues };

  const lastModified = statSync(fullPath).mtimeMs;
  const entry = registry.upsert({
    name: body.name ?? demoParse.data.name,
    repoPath,
    demoPath,
    valid: true,
    lastModified,
  });

  watcher?.watch(entry.id);

  let sdkResult: { outcome: 'written' | 'present' | 'skipped'; filePath: string | null };
  try {
    sdkResult = writeSdkEmitIfNeeded(repoPath, demoParse.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'sdkWriteFailed', id: entry.id, slug: entry.slug, message };
  }

  return {
    kind: 'ok',
    data: {
      id: entry.id,
      slug: entry.slug,
      sdk: { outcome: sdkResult.outcome, filePath: sdkResult.filePath },
    },
  };
}

export function deleteDemoImpl(deps: OperationsDeps, idOrSlug: string): DeleteDemoOutcome {
  const { registry, watcher } = deps;
  const entry = registry.getById(idOrSlug) ?? registry.getBySlug(idOrSlug);
  if (!entry) return { kind: 'notFound' };
  watcher?.unwatch(entry.id);
  registry.remove(entry.id);
  return { kind: 'ok' };
}

export async function createProjectImpl(
  deps: OperationsDeps,
  body: CreateProjectBody,
): Promise<CreateProjectOutcome> {
  const { registry, watcher } = deps;
  const { name, folderPath } = body;
  if (!isAbsolute(folderPath)) return { kind: 'invalidPath' };

  const demoFullPath = join(folderPath, DEFAULT_DEMO_RELATIVE_PATH);

  if (existsSync(demoFullPath)) {
    let raw: unknown;
    try {
      raw = await Bun.file(demoFullPath).json();
    } catch (err) {
      return { kind: 'badJson', detail: err instanceof Error ? err.message : String(err) };
    }
    const demoParse = DemoSchema.safeParse(raw);
    if (!demoParse.success) return { kind: 'badSchema', issues: demoParse.error.issues };

    const lastModified = statSync(demoFullPath).mtimeMs;
    const entry = registry.upsert({
      name,
      repoPath: folderPath,
      demoPath: DEFAULT_DEMO_RELATIVE_PATH,
      valid: true,
      lastModified,
    });
    watcher?.watch(entry.id);
    return { kind: 'ok', data: { id: entry.id, slug: entry.slug, scaffolded: false } };
  }

  const scaffold: Demo = { version: 1, name, nodes: [], connectors: [] };

  try {
    mkdirSync(join(folderPath, '.anydemo'), { recursive: true });
    writeFileSync(demoFullPath, `${JSON.stringify(scaffold, null, 2)}\n`);
  } catch (err) {
    return { kind: 'scaffoldFailed', message: err instanceof Error ? err.message : String(err) };
  }

  // Same SDK-emit path as the CLI register flow. For a fresh scaffold with no
  // event-bound state nodes this returns 'skipped' and writes nothing —
  // retained for parity with `anydemo register`.
  try {
    writeSdkEmitIfNeeded(folderPath, scaffold);
  } catch (err) {
    return { kind: 'sdkWriteFailed', message: err instanceof Error ? err.message : String(err) };
  }

  const lastModified = statSync(demoFullPath).mtimeMs;
  const entry = registry.upsert({
    name,
    repoPath: folderPath,
    demoPath: DEFAULT_DEMO_RELATIVE_PATH,
    valid: true,
    lastModified,
  });
  watcher?.watch(entry.id);
  return { kind: 'ok', data: { id: entry.id, slug: entry.slug, scaffolded: true } };
}

// Append a new node to the demo. Auto-generates an id when absent; DemoSchema
// is re-run on the post-mutation raw object before commit so a malformed
// payload never produces a half-written file.
export async function addNodeImpl(
  deps: OperationsDeps,
  demoId: string,
  nodeBody: Record<string, unknown>,
): Promise<AddNodeOutcome> {
  const entry = deps.registry.getById(demoId);
  if (!entry) return { kind: 'demoNotFound' };

  const newNode = { ...nodeBody };
  if (typeof newNode.id !== 'string' || newNode.id.length === 0) {
    newNode.id = `node-${crypto.randomUUID()}`;
  }
  const newId = newNode.id as string;

  const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  type Inner =
    | { kind: 'ok' }
    | { kind: 'badJson'; message: string }
    | { kind: 'badSchema'; issues: ZodIssue[] }
    | { kind: 'writeFailed'; message: string };

  const result = await withDemoWriteLock<Inner>(demoId, async () => {
    let raw: unknown;
    try {
      raw = await Bun.file(fullPath).json();
    } catch (err) {
      return { kind: 'badJson', message: err instanceof Error ? err.message : String(err) };
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
      return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
    }
    return { kind: 'ok' };
  });

  if (result.kind === 'ok') return { kind: 'ok', data: { id: newId } };
  return result;
}

// Remove a node and cascade-delete every connector touching it in a single
// atomic write. Final DemoSchema parse stays in place so a pre-existing
// schema violation surfaces honestly instead of being silently papered over.
export async function deleteNodeImpl(
  deps: OperationsDeps,
  demoId: string,
  nodeId: string,
): Promise<DeleteNodeOutcome> {
  const entry = deps.registry.getById(demoId);
  if (!entry) return { kind: 'demoNotFound' };

  const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  type Inner =
    | { kind: 'ok' }
    | { kind: 'badJson'; message: string }
    | { kind: 'badSchema'; issues: ZodIssue[] }
    | { kind: 'unknownNode' }
    | { kind: 'writeFailed'; message: string };

  const result = await withDemoWriteLock<Inner>(demoId, async () => {
    let raw: unknown;
    try {
      raw = await Bun.file(fullPath).json();
    } catch (err) {
      return { kind: 'badJson', message: err instanceof Error ? err.message : String(err) };
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
      return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
    }
    return { kind: 'ok' };
  });

  return result;
}

// Move a single node by writing { x, y } back to its `position` on disk.
// Mutates the *raw* parsed JSON so any unknown forward-compat fields the
// schema doesn't yet recognize survive the round-trip untouched.
export async function moveNodeImpl(
  deps: OperationsDeps,
  demoId: string,
  nodeId: string,
  position: PositionBody,
): Promise<MoveNodeOutcome> {
  const entry = deps.registry.getById(demoId);
  if (!entry) return { kind: 'demoNotFound' };

  const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  type Inner =
    | { kind: 'ok' }
    | { kind: 'badJson'; message: string }
    | { kind: 'badSchema'; issues: ZodIssue[] }
    | { kind: 'unknownNode' }
    | { kind: 'writeFailed'; message: string };

  const result = await withDemoWriteLock<Inner>(demoId, async () => {
    let raw: unknown;
    try {
      raw = await Bun.file(fullPath).json();
    } catch (err) {
      return { kind: 'badJson', message: err instanceof Error ? err.message : String(err) };
    }
    const demoParsed = DemoSchema.safeParse(raw);
    if (!demoParsed.success) return { kind: 'badSchema', issues: demoParsed.error.issues };

    const obj = raw as {
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
    };
    const onDiskNode = obj.nodes.find((n) => n.id === nodeId);
    if (!onDiskNode) return { kind: 'unknownNode' };
    onDiskNode.position = { x: position.x, y: position.y };

    try {
      writeFileAtomic(fullPath, `${JSON.stringify(obj, null, 2)}\n`);
    } catch (err) {
      return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
    }
    return { kind: 'ok' };
  });

  if (result.kind === 'ok') {
    return { kind: 'ok', data: { position: { x: position.x, y: position.y } } };
  }
  return result;
}

// Apply a partial PATCH body to a single node. Mutation runs against the
// raw parsed JSON (so unknown forward-compat fields survive a round-trip),
// and the whole demo is re-validated through DemoSchema before commit so
// partial writes can't break invariants like the connector→node superRefine.
export async function patchNodeImpl(
  deps: OperationsDeps,
  demoId: string,
  nodeId: string,
  updates: NodePatchBody,
): Promise<PatchNodeOutcome> {
  const entry = deps.registry.getById(demoId);
  if (!entry) return { kind: 'demoNotFound' };

  const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  type Inner =
    | { kind: 'ok' }
    | { kind: 'badJson'; message: string }
    | { kind: 'badSchema'; issues: ZodIssue[] }
    | { kind: 'unknownNode' }
    | { kind: 'writeFailed'; message: string };

  const result = await withDemoWriteLock<Inner>(demoId, async () => {
    let raw: unknown;
    try {
      raw = await Bun.file(fullPath).json();
    } catch (err) {
      return { kind: 'badJson', message: err instanceof Error ? err.message : String(err) };
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
      return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
    }
    return { kind: 'ok' };
  });

  return result;
}

// Reorder a node within demo.nodes[] (changes paint order in the canvas).
// A no-op reorder (e.g. forward on the topmost node) returns ok without
// writing so we don't trigger a watcher echo for nothing.
export async function reorderNodeImpl(
  deps: OperationsDeps,
  demoId: string,
  nodeId: string,
  body: ReorderBody,
): Promise<ReorderNodeOutcome> {
  const entry = deps.registry.getById(demoId);
  if (!entry) return { kind: 'demoNotFound' };

  const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  type Inner =
    | { kind: 'ok' }
    | { kind: 'badJson'; message: string }
    | { kind: 'badSchema'; issues: ZodIssue[] }
    | { kind: 'unknownNode' }
    | { kind: 'writeFailed'; message: string };

  const result = await withDemoWriteLock<Inner>(demoId, async () => {
    let raw: unknown;
    try {
      raw = await Bun.file(fullPath).json();
    } catch (err) {
      return { kind: 'badJson', message: err instanceof Error ? err.message : String(err) };
    }
    const demoParsed = DemoSchema.safeParse(raw);
    if (!demoParsed.success) return { kind: 'badSchema', issues: demoParsed.error.issues };

    const obj = raw as { nodes: Array<Record<string, unknown>> };
    const fromIdx = obj.nodes.findIndex((n) => n.id === nodeId);
    if (fromIdx < 0) return { kind: 'unknownNode' };

    const moved = reorderNodes(obj.nodes, fromIdx, body);
    if (!moved) return { kind: 'ok' };

    const finalParse = DemoSchema.safeParse(raw);
    if (!finalParse.success) return { kind: 'badSchema', issues: finalParse.error.issues };

    try {
      writeFileAtomic(fullPath, `${JSON.stringify(raw, null, 2)}\n`);
    } catch (err) {
      return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
    }
    return { kind: 'ok' };
  });

  return result;
}

// Append a new connector to demo.connectors. `id` is auto-generated when
// absent and `kind` defaults to 'default' (the no-semantics user-drawn
// variant). Source/target referential integrity is enforced by DemoSchema's
// superRefine on the post-mutation parse.
export async function addConnectorImpl(
  deps: OperationsDeps,
  demoId: string,
  connBody: Record<string, unknown>,
): Promise<AddConnectorOutcome> {
  const entry = deps.registry.getById(demoId);
  if (!entry) return { kind: 'demoNotFound' };

  const newConn = { ...connBody };
  if (typeof newConn.id !== 'string' || newConn.id.length === 0) {
    newConn.id = `conn-${crypto.randomUUID()}`;
  }
  if (typeof newConn.kind !== 'string' || newConn.kind.length === 0) {
    newConn.kind = 'default';
  }
  const newId = newConn.id as string;

  const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  type Inner =
    | { kind: 'ok' }
    | { kind: 'badJson'; message: string }
    | { kind: 'badSchema'; issues: ZodIssue[] }
    | { kind: 'writeFailed'; message: string };

  const result = await withDemoWriteLock<Inner>(demoId, async () => {
    let raw: unknown;
    try {
      raw = await Bun.file(fullPath).json();
    } catch (err) {
      return { kind: 'badJson', message: err instanceof Error ? err.message : String(err) };
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
      return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
    }
    return { kind: 'ok' };
  });

  if (result.kind === 'ok') return { kind: 'ok', data: { id: newId } };
  return result;
}

// Apply a partial PATCH body to a single connector. Mutation runs against
// the raw parsed JSON (so unknown forward-compat fields survive a round-trip).
// When `kind` changes, the previous kind's payload fields are dropped first
// so the connector doesn't carry phantom data; explicit `null` in the patch
// clears the field on disk (used by reconnect-to-body to drop a pinned
// handle id). The whole demo is re-validated through DemoSchema before
// commit so the discriminated union catches missing-required-fields
// (e.g. kind='event' without eventName) and the superRefine gates
// source/target referential integrity + handle role invariants.
export async function patchConnectorImpl(
  deps: OperationsDeps,
  demoId: string,
  connectorId: string,
  updates: ConnectorPatchBody,
): Promise<PatchConnectorOutcome> {
  const entry = deps.registry.getById(demoId);
  if (!entry) return { kind: 'demoNotFound' };

  const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  type Inner =
    | { kind: 'ok' }
    | { kind: 'badJson'; message: string }
    | { kind: 'badSchema'; issues: ZodIssue[] }
    | { kind: 'unknownConnector' }
    | { kind: 'writeFailed'; message: string };

  const result = await withDemoWriteLock<Inner>(demoId, async () => {
    let raw: unknown;
    try {
      raw = await Bun.file(fullPath).json();
    } catch (err) {
      return { kind: 'badJson', message: err instanceof Error ? err.message : String(err) };
    }
    const demoParsed = DemoSchema.safeParse(raw);
    if (!demoParsed.success) return { kind: 'badSchema', issues: demoParsed.error.issues };

    const obj = raw as { connectors: Array<Record<string, unknown>> };
    const onDiskConn = obj.connectors.find((cn) => cn.id === connectorId);
    if (!onDiskConn) return { kind: 'unknownConnector' };

    mergeConnectorUpdates(onDiskConn, updates);

    const finalParse = DemoSchema.safeParse(raw);
    if (!finalParse.success) return { kind: 'badSchema', issues: finalParse.error.issues };

    try {
      writeFileAtomic(fullPath, `${JSON.stringify(raw, null, 2)}\n`);
    } catch (err) {
      return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
    }
    return { kind: 'ok' };
  });

  return result;
}

// Remove a connector by id. No cascade — node deletion is what cascades,
// not connector deletion. Final DemoSchema parse still runs so a pre-existing
// schema violation surfaces honestly instead of being silently papered over.
export async function deleteConnectorImpl(
  deps: OperationsDeps,
  demoId: string,
  connectorId: string,
): Promise<DeleteConnectorOutcome> {
  const entry = deps.registry.getById(demoId);
  if (!entry) return { kind: 'demoNotFound' };

  const fullPath = resolveDemoPath(entry.repoPath, entry.demoPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  type Inner =
    | { kind: 'ok' }
    | { kind: 'badJson'; message: string }
    | { kind: 'badSchema'; issues: ZodIssue[] }
    | { kind: 'unknownConnector' }
    | { kind: 'writeFailed'; message: string };

  const result = await withDemoWriteLock<Inner>(demoId, async () => {
    let raw: unknown;
    try {
      raw = await Bun.file(fullPath).json();
    } catch (err) {
      return { kind: 'badJson', message: err instanceof Error ? err.message : String(err) };
    }
    const demoParsed = DemoSchema.safeParse(raw);
    if (!demoParsed.success) return { kind: 'badSchema', issues: demoParsed.error.issues };

    const obj = raw as { connectors: Array<{ id: string }> };
    const idx = obj.connectors.findIndex((cn) => cn.id === connectorId);
    if (idx < 0) return { kind: 'unknownConnector' };
    obj.connectors.splice(idx, 1);

    const finalParse = DemoSchema.safeParse(raw);
    if (!finalParse.success) return { kind: 'badSchema', issues: finalParse.error.issues };

    try {
      writeFileAtomic(fullPath, `${JSON.stringify(raw, null, 2)}\n`);
    } catch (err) {
      return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
    }
    return { kind: 'ok' };
  });

  return result;
}
