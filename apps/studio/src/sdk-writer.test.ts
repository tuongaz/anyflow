import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Demo } from './schema.ts';
import { writeSdkEmitIfNeeded } from './sdk-writer.ts';

const REQUEST_DEMO: Demo = {
  version: 1,
  name: 'Request only',
  nodes: [
    {
      id: 'api-checkout',
      type: 'playNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'POST /checkout',
        kind: 'service',
        stateSource: { kind: 'request' },
        playAction: { kind: 'http', method: 'POST', url: 'http://localhost:3001/checkout' },
      },
    },
  ],
  connectors: [],
};

const EVENT_DEMO: Demo = {
  ...REQUEST_DEMO,
  name: 'With worker',
  nodes: [
    ...REQUEST_DEMO.nodes,
    {
      id: 'worker',
      type: 'stateNode',
      position: { x: 200, y: 0 },
      data: {
        label: 'Worker',
        kind: 'worker',
        stateSource: { kind: 'event' },
      },
    },
  ],
};

const tmpRepo = (): string => mkdtempSync(join(tmpdir(), 'anydemo-sdk-writer-'));

describe('writeSdkEmitIfNeeded', () => {
  it('skips repos whose demo has no event-bound state node', () => {
    const repoPath = tmpRepo();
    const result = writeSdkEmitIfNeeded(repoPath, REQUEST_DEMO);
    expect(result.outcome).toBe('skipped');
    expect(result.filePath).toBeNull();
  });

  it('writes .anydemo/sdk/emit.ts when an event-bound state node is present', () => {
    const repoPath = tmpRepo();
    const result = writeSdkEmitIfNeeded(repoPath, EVENT_DEMO);
    expect(result.outcome).toBe('written');
    expect(result.filePath).toBe(join(repoPath, '.anydemo', 'sdk', 'emit.ts'));

    const written = readFileSync(result.filePath as string, 'utf-8');
    expect(written).toContain('export async function emit');
    expect(written).toContain('/api/emit');
    // Self-contained: no @anydemo/sdk import.
    expect(written).not.toContain('@anydemo/sdk');
  });

  it('does not overwrite an existing emit.ts (idempotent)', () => {
    const repoPath = tmpRepo();
    const filePath = join(repoPath, '.anydemo', 'sdk', 'emit.ts');
    mkdirSync(join(repoPath, '.anydemo', 'sdk'), { recursive: true });
    writeFileSync(filePath, '// USER EDITED\n');

    const result = writeSdkEmitIfNeeded(repoPath, EVENT_DEMO);
    expect(result.outcome).toBe('present');
    expect(result.filePath).toBe(filePath);
    expect(readFileSync(filePath, 'utf-8')).toBe('// USER EDITED\n');
  });
});
