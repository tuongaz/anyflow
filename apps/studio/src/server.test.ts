import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRegistry } from './registry.ts';
import { createApp } from './server.ts';
import type { Spawner } from './shellout.ts';

describe('createApp', () => {
  it('GET /health returns { ok: true }', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown route returns 404', async () => {
    const app = createApp({ mode: 'prod', staticRoot: './dist/web' });
    const res = await app.request('/__definitely_not_a_route__');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/projects/:id/files/:path', () => {
  const buildFixture = () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'anydemo-files-repo-'));
    mkdirSync(join(repoDir, '.anydemo', 'assets'), { recursive: true });
    writeFileSync(join(repoDir, '.anydemo', 'demo.json'), '{"version":1}');
    writeFileSync(join(repoDir, '.anydemo', 'assets', 'hello.txt'), 'hi there');
    writeFileSync(join(repoDir, '.anydemo', 'blocks-card.html'), '<p>hi</p>');
    // A secret file just outside .anydemo to verify traversal defense.
    writeFileSync(join(repoDir, 'secret.txt'), 'never expose me');

    const registry = createRegistry({
      path: join(mkdtempSync(join(tmpdir(), 'anydemo-files-reg-')), 'registry.json'),
    });
    const entry = registry.upsert({
      name: 'Files Test',
      repoPath: repoDir,
      demoPath: '.anydemo/demo.json',
    });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      disableWatcher: true,
    });
    return { app, projectId: entry.id, repoDir };
  };

  it('streams the file with a content-type for a happy path', async () => {
    const { app, projectId } = buildFixture();
    const res = await app.request(`/api/projects/${projectId}/files/assets/hello.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/plain');
    expect(await res.text()).toBe('hi there');
  });

  it('returns 404 for a missing file', async () => {
    const { app, projectId } = buildFixture();
    const res = await app.request(`/api/projects/${projectId}/files/assets/nope.txt`);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toHaveProperty('error');
  });

  it('returns 400 when the path contains `..` traversal', async () => {
    const { app, projectId } = buildFixture();
    const res = await app.request(`/api/projects/${projectId}/files/..%2Fsecret.txt`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/traversal/i);
  });

  it('returns 400 when the path is absolute', async () => {
    const { app, projectId } = buildFixture();
    const res = await app.request(`/api/projects/${projectId}/files/%2Fetc%2Fpasswd`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/absolute/i);
  });

  it('returns 404 for an unknown projectId', async () => {
    const { app } = buildFixture();
    const res = await app.request('/api/projects/does-not-exist/files/assets/hello.txt');
    expect(res.status).toBe(404);
  });
});

interface ShelloutFixture {
  app: ReturnType<typeof createApp>;
  projectId: string;
  repoDir: string;
  calls: Array<{ cmd: string; args: string[] }>;
  blockHtmlAbs: string;
}

const buildShelloutFixture = (opts?: {
  spawnResult?: { ok: boolean; error?: string };
  platform?: NodeJS.Platform;
}): ShelloutFixture => {
  const repoDir = mkdtempSync(join(tmpdir(), 'anydemo-shellout-repo-'));
  mkdirSync(join(repoDir, '.anydemo', 'blocks'), { recursive: true });
  writeFileSync(join(repoDir, '.anydemo', 'demo.json'), '{"version":1}');
  writeFileSync(join(repoDir, '.anydemo', 'blocks', 'card.html'), '<p>hi</p>');
  writeFileSync(join(repoDir, 'secret.txt'), 'never expose me');

  const registry = createRegistry({
    path: join(mkdtempSync(join(tmpdir(), 'anydemo-shellout-reg-')), 'registry.json'),
  });
  const entry = registry.upsert({
    name: 'Shellout Test',
    repoPath: repoDir,
    demoPath: '.anydemo/demo.json',
  });

  const calls: Array<{ cmd: string; args: string[] }> = [];
  const spawner: Spawner = async (cmd, args) => {
    calls.push({ cmd, args });
    return opts?.spawnResult ?? { ok: true };
  };

  const app = createApp({
    mode: 'prod',
    staticRoot: './dist/web',
    registry,
    disableWatcher: true,
    spawner,
    platform: opts?.platform,
  });

  // Match the realpath the resolver will produce (macOS /var → /private/var).
  return {
    app,
    projectId: entry.id,
    repoDir,
    calls,
    blockHtmlAbs: realpathSync(join(repoDir, '.anydemo', 'blocks', 'card.html')),
  };
};

const jsonPost = (path: string, body: unknown): Request =>
  new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// Save + restore process.env.EDITOR around a test. `value === undefined`
// clears the variable (using `delete` since `process.env.X = undefined`
// stringifies to "undefined" in node's env mirror, which would defeat the
// `EDITOR not set` branch).
const withEditor = async (value: string | undefined, run: () => Promise<void>) => {
  const prev = process.env.EDITOR;
  if (value === undefined) {
    // biome-ignore lint/performance/noDelete: assigning undefined to process.env coerces to the literal string "undefined".
    delete process.env.EDITOR;
  } else {
    process.env.EDITOR = value;
  }
  try {
    await run();
  } finally {
    if (prev === undefined) {
      // biome-ignore lint/performance/noDelete: see above — process.env requires `delete` to truly clear.
      delete process.env.EDITOR;
    } else {
      process.env.EDITOR = prev;
    }
  }
};

describe('POST /api/projects/:id/files/open', () => {
  it('spawns $EDITOR with the absolute path on the happy path', () =>
    withEditor('vim', async () => {
      const fix = buildShelloutFixture();
      const res = await fix.app.fetch(
        jsonPost(`/api/projects/${fix.projectId}/files/open`, { path: 'blocks/card.html' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; absPath: string };
      expect(body.ok).toBe(true);
      expect(body.absPath).toBe(fix.blockHtmlAbs);
      expect(fix.calls).toEqual([{ cmd: 'vim', args: [fix.blockHtmlAbs] }]);
    }));

  it('returns absPath fallback (no spawn) when $EDITOR is unset', () =>
    withEditor(undefined, async () => {
      const fix = buildShelloutFixture();
      const res = await fix.app.fetch(
        jsonPost(`/api/projects/${fix.projectId}/files/open`, { path: 'blocks/card.html' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; absPath: string; error: string };
      expect(body.ok).toBe(false);
      expect(body.absPath).toBe(fix.blockHtmlAbs);
      expect(body.error).toMatch(/EDITOR/);
      expect(fix.calls).toEqual([]);
    }));

  it('returns absPath fallback when spawn fails', () =>
    withEditor('no-such-editor', async () => {
      const fix = buildShelloutFixture({ spawnResult: { ok: false, error: 'spawn ENOENT' } });
      const res = await fix.app.fetch(
        jsonPost(`/api/projects/${fix.projectId}/files/open`, { path: 'blocks/card.html' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; absPath: string; error: string };
      expect(body.ok).toBe(false);
      expect(body.absPath).toBe(fix.blockHtmlAbs);
      expect(body.error).toBe('spawn ENOENT');
    }));

  it('rejects `..` traversal with 400', async () => {
    const fix = buildShelloutFixture();
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/open`, { path: '../secret.txt' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/traversal/i);
    expect(fix.calls).toEqual([]);
  });

  it('rejects absolute paths with 400', async () => {
    const fix = buildShelloutFixture();
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/open`, { path: '/etc/passwd' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/absolute/i);
    expect(fix.calls).toEqual([]);
  });

  it('soft-fails with 404 JSON (no 500) for a missing file', async () => {
    const fix = buildShelloutFixture();
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/open`, { path: 'blocks/nope.html' }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; absPath: string };
    expect(body.error).toMatch(/not found/i);
    expect(body.absPath).toBe(join(fix.repoDir, '.anydemo', 'blocks', 'nope.html'));
    expect(fix.calls).toEqual([]);
  });

  it('returns 404 for an unknown projectId', async () => {
    const fix = buildShelloutFixture();
    const res = await fix.app.fetch(
      jsonPost('/api/projects/does-not-exist/files/open', { path: 'blocks/card.html' }),
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/projects/:id/files/reveal', () => {
  it('uses `open -R <abs>` on darwin', async () => {
    const fix = buildShelloutFixture({ platform: 'darwin' });
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/reveal`, { path: 'blocks/card.html' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; absPath: string };
    expect(body.ok).toBe(true);
    expect(body.absPath).toBe(fix.blockHtmlAbs);
    expect(fix.calls).toEqual([{ cmd: 'open', args: ['-R', fix.blockHtmlAbs] }]);
  });

  it('uses `explorer /select,<abs>` on win32', async () => {
    const fix = buildShelloutFixture({ platform: 'win32' });
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/reveal`, { path: 'blocks/card.html' }),
    );
    expect(res.status).toBe(200);
    expect(fix.calls).toEqual([{ cmd: 'explorer', args: [`/select,${fix.blockHtmlAbs}`] }]);
  });

  it('uses `xdg-open <dir>` on linux', async () => {
    const fix = buildShelloutFixture({ platform: 'linux' });
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/reveal`, { path: 'blocks/card.html' }),
    );
    expect(res.status).toBe(200);
    expect(fix.calls).toEqual([{ cmd: 'xdg-open', args: [dirname(fix.blockHtmlAbs)] }]);
  });

  it('rejects `..` traversal with 400', async () => {
    const fix = buildShelloutFixture({ platform: 'darwin' });
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/reveal`, { path: '../secret.txt' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/traversal/i);
    expect(fix.calls).toEqual([]);
  });

  it('soft-fails with 404 JSON for a missing file', async () => {
    const fix = buildShelloutFixture({ platform: 'darwin' });
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/reveal`, { path: 'blocks/nope.html' }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; absPath: string };
    expect(body.error).toMatch(/not found/i);
    expect(body.absPath).toBe(join(fix.repoDir, '.anydemo', 'blocks', 'nope.html'));
    expect(fix.calls).toEqual([]);
  });

  it('returns absPath fallback when spawn fails', async () => {
    const fix = buildShelloutFixture({
      platform: 'darwin',
      spawnResult: { ok: false, error: 'spawn ENOENT' },
    });
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/reveal`, { path: 'blocks/card.html' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; absPath: string; error: string };
    expect(body.ok).toBe(false);
    expect(body.absPath).toBe(fix.blockHtmlAbs);
    expect(body.error).toBe('spawn ENOENT');
  });
});
