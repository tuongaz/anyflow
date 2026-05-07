import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Registry } from './registry.ts';
import { DemoSchema } from './schema.ts';

const RegisterBodySchema = z.object({
  name: z.string().min(1).optional(),
  repoPath: z.string().min(1),
  demoPath: z.string().min(1),
});

export interface ApiOptions {
  registry: Registry;
}

export function createApi(options: ApiOptions): Hono {
  const { registry } = options;
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
    const fullPath = isAbsolute(demoPath) ? demoPath : join(repoPath, demoPath);

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

    return c.json({ id: entry.id, slug: entry.slug });
  });

  api.get('/demos', (c) => {
    return c.json(
      registry.list().map((e) => {
        const fullPath = isAbsolute(e.demoPath) ? e.demoPath : join(e.repoPath, e.demoPath);
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

  api.delete('/demos/:id', (c) => {
    const id = c.req.param('id');
    const removed = registry.remove(id);
    if (!removed) return c.json({ ok: false, error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  return api;
}
