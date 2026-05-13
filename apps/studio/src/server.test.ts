import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry } from './registry.ts';
import { createApp } from './server.ts';

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
