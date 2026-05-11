// Shared inner helpers that REST handlers in api.ts and MCP tool handlers in
// mcp.ts both call. Each helper returns an Outcome discriminated union so the
// caller layer can translate it into its native response shape (HTTP status
// vs. MCP CallToolResult) without duplicating any of the business logic.
//
// Helpers extracted in US-002: discovery + project setup (5 tools).
// Future stories add node/connector helpers alongside these.

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { type ZodIssue, z } from 'zod';
import type { Registry } from './registry.ts';
import { type Demo, DemoSchema } from './schema.ts';
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

const resolveDemoPath = (repoPath: string, demoPath: string): string =>
  isAbsolute(demoPath) ? demoPath : join(repoPath, demoPath);

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
