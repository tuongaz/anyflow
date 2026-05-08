import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearPid,
  isPidAlive,
  readConfig,
  readPid,
  studioUrl,
  writeConfig,
  writePid,
} from './runtime.ts';

const tmpFile = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'anydemo-runtime-'));
  return join(dir, name);
};

describe('readConfig', () => {
  it('returns defaults when file does not exist', () => {
    expect(readConfig(tmpFile('config.json'))).toEqual({ port: 4321, host: '0.0.0.0' });
  });

  it('returns defaults when file is corrupt', () => {
    const path = tmpFile('config.json');
    writeFileSync(path, '{ not json');
    expect(readConfig(path)).toEqual({ port: 4321, host: '0.0.0.0' });
  });

  it('merges user-set fields with defaults', () => {
    const path = tmpFile('config.json');
    writeFileSync(path, JSON.stringify({ port: 9999 }));
    expect(readConfig(path)).toEqual({ port: 9999, host: '0.0.0.0' });
  });
});

describe('writeConfig', () => {
  it('round-trips with readConfig', () => {
    const path = tmpFile('config.json');
    writeConfig({ port: 5000, host: '127.0.0.1' }, path);
    expect(readConfig(path)).toEqual({ port: 5000, host: '127.0.0.1' });
  });
});

describe('studioUrl', () => {
  it('formats host:port as http URL', () => {
    expect(studioUrl({ port: 4321, host: 'localhost' })).toBe('http://localhost:4321');
    expect(studioUrl({ port: 8080, host: '127.0.0.1' })).toBe('http://127.0.0.1:8080');
  });
});

describe('pid', () => {
  it('writePid + readPid round-trip', () => {
    const path = tmpFile('anydemo.pid');
    writePid(99999, path);
    expect(readPid(path)).toBe(99999);
  });

  it('readPid returns undefined when missing', () => {
    expect(readPid(tmpFile('missing.pid'))).toBeUndefined();
  });

  it('readPid returns undefined when contents non-numeric', () => {
    const path = tmpFile('anydemo.pid');
    writeFileSync(path, 'abc');
    expect(readPid(path)).toBeUndefined();
  });

  it('clearPid removes file (and is safe when missing)', () => {
    const path = tmpFile('anydemo.pid');
    writePid(123, path);
    clearPid(path);
    expect(existsSync(path)).toBe(false);
    clearPid(path);
    expect(existsSync(path)).toBe(false);
  });

  it('isPidAlive: true for our own pid, false for impossibly large pid', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(2_147_483_646)).toBe(false);
  });
});
