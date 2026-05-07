import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type StudioEvent, createEventBus } from './events.ts';
import { createRegistry } from './registry.ts';
import { createWatcher } from './watcher.ts';

const VALID_DEMO = {
  version: 1,
  name: 'Watch Me',
  nodes: [
    {
      id: 'a',
      type: 'playNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'A',
        kind: 'svc',
        stateSource: { kind: 'request' },
        playAction: { kind: 'http', method: 'GET', url: 'http://x' },
      },
    },
  ],
  edges: [],
};

const tmpRepo = (demo: unknown = VALID_DEMO) => {
  const dir = mkdtempSync(join(tmpdir(), 'watcher-repo-'));
  mkdirSync(join(dir, '.anydemo'));
  writeFileSync(join(dir, '.anydemo', 'demo.json'), JSON.stringify(demo));
  return dir;
};

const tmpRegistryPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'watcher-reg-'));
  return join(dir, 'registry.json');
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createWatcher', () => {
  it('seeds a valid snapshot when watch() starts on a parseable file', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({ name: 'Watch Me', repoPath, demoPath: '.anydemo/demo.json' });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    const snap = watcher.snapshot(entry.id);
    expect(snap).not.toBeNull();
    expect(snap?.valid).toBe(true);
    expect(snap?.demo?.name).toBe('Watch Me');
    expect(snap?.error).toBeNull();
    watcher.closeAll();
  });

  it('broadcasts demo:reload with valid:true on parse, valid:false on bad JSON', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({ name: 'Watch Me', repoPath, demoPath: '.anydemo/demo.json' });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 20 });

    const received: StudioEvent[] = [];
    events.subscribe(entry.id, (e) => received.push(e));

    watcher.watch(entry.id);

    // Force a write that should land after the watcher is up.
    await wait(50);
    writeFileSync(join(repoPath, '.anydemo', 'demo.json'), '{ not: json }');
    await wait(150);

    const last = received.at(-1);
    expect(last?.type).toBe('demo:reload');
    expect((last?.payload as { valid: boolean }).valid).toBe(false);
    expect((last?.payload as { error: string }).error).toContain('Invalid JSON');

    // Repair the file. Should flip back to valid:true and broadcast a new event.
    writeFileSync(join(repoPath, '.anydemo', 'demo.json'), JSON.stringify(VALID_DEMO));
    await wait(150);

    const finalEvent = received.at(-1);
    expect((finalEvent?.payload as { valid: boolean }).valid).toBe(true);
    watcher.closeAll();
  });

  it('keeps the last-good demo on snapshot when current parse is invalid', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({ name: 'Watch Me', repoPath, demoPath: '.anydemo/demo.json' });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    const good = watcher.snapshot(entry.id);
    expect(good?.valid).toBe(true);

    writeFileSync(join(repoPath, '.anydemo', 'demo.json'), 'oops');
    const reparsed = watcher.reparse(entry.id);
    expect(reparsed?.valid).toBe(false);
    expect(reparsed?.demo?.name).toBe('Watch Me');
    watcher.closeAll();
  });

  it('reports schema validation errors with usable path detail', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    // Missing top-level `name` field.
    const repoPath = tmpRepo({ ...VALID_DEMO, name: undefined });
    const entry = reg.upsert({ name: 'Watch Me', repoPath, demoPath: '.anydemo/demo.json' });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    const snap = watcher.snapshot(entry.id);
    expect(snap?.valid).toBe(false);
    expect(snap?.error).toContain('Schema validation failed');
    expect(snap?.error).toContain('name');
    watcher.closeAll();
  });

  it('unwatch() clears the snapshot and stops further events', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({ name: 'Watch Me', repoPath, demoPath: '.anydemo/demo.json' });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    let count = 0;
    events.subscribe(entry.id, () => {
      count++;
    });

    watcher.watch(entry.id);
    expect(watcher.snapshot(entry.id)).not.toBeNull();

    watcher.unwatch(entry.id);
    expect(watcher.snapshot(entry.id)).toBeNull();

    writeFileSync(join(repoPath, '.anydemo', 'demo.json'), JSON.stringify(VALID_DEMO));
    await wait(80);
    expect(count).toBe(0);
    watcher.closeAll();
  });
});
