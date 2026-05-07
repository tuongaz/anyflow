import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry, slugify } from './registry.ts';

const tmpRegistryPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'anydemo-registry-'));
  return join(dir, 'registry.json');
};

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with dashes', () => {
    expect(slugify('Checkout Flow')).toBe('checkout-flow');
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  spaces   here ')).toBe('spaces-here');
  });

  it('returns "demo" for empty/non-alphanumeric input', () => {
    expect(slugify('')).toBe('demo');
    expect(slugify('!!!')).toBe('demo');
  });
});

describe('createRegistry', () => {
  it('upsert adds a new entry with id + slug', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const entry = reg.upsert({
      name: 'Checkout Flow',
      repoPath: '/tmp/repo-a',
      demoPath: '.anydemo/demo.json',
    });
    expect(entry.id).toBeTruthy();
    expect(entry.slug).toBe('checkout-flow');
    expect(reg.list()).toHaveLength(1);
  });

  it('different repos with the same name get -2, -3 collision suffixes', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert({ name: 'Dup', repoPath: '/tmp/a', demoPath: 'd.json' });
    const b = reg.upsert({ name: 'Dup', repoPath: '/tmp/b', demoPath: 'd.json' });
    const c = reg.upsert({ name: 'Dup', repoPath: '/tmp/c', demoPath: 'd.json' });
    expect(a.slug).toBe('dup');
    expect(b.slug).toBe('dup-2');
    expect(c.slug).toBe('dup-3');
  });

  it('re-registering the same repoPath keeps id + slug, updates name', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const first = reg.upsert({ name: 'Old name', repoPath: '/tmp/r', demoPath: 'd.json' });
    const second = reg.upsert({ name: 'New name', repoPath: '/tmp/r', demoPath: 'd.json' });
    expect(second.id).toBe(first.id);
    expect(second.slug).toBe(first.slug);
    expect(second.name).toBe('New name');
    expect(reg.list()).toHaveLength(1);
  });

  it('persists to disk on every mutation and rehydrates on construct', () => {
    const path = tmpRegistryPath();
    const reg1 = createRegistry({ path });
    reg1.upsert({ name: 'Persist me', repoPath: '/tmp/p', demoPath: 'd.json' });

    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    expect(Array.isArray(onDisk)).toBe(true);
    expect(onDisk).toHaveLength(1);

    const reg2 = createRegistry({ path });
    expect(reg2.list()).toHaveLength(1);
    expect(reg2.list()[0]?.name).toBe('Persist me');
  });

  it('remove deletes by id and persists', () => {
    const path = tmpRegistryPath();
    const reg = createRegistry({ path });
    const entry = reg.upsert({ name: 'X', repoPath: '/tmp/x', demoPath: 'd.json' });
    expect(reg.remove(entry.id)).toBe(true);
    expect(reg.list()).toHaveLength(0);

    const reg2 = createRegistry({ path });
    expect(reg2.list()).toHaveLength(0);
  });

  it('starts empty when registry.json is corrupt', () => {
    const path = tmpRegistryPath();
    writeFileSync(path, '{ this is not json');
    const reg = createRegistry({ path });
    expect(reg.list()).toHaveLength(0);
  });
});
