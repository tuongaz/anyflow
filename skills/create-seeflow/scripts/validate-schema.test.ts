import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSchemaFile } from './validate-schema';

interface DemoFixture {
  version: 1;
  name: string;
  nodes: unknown[];
  connectors: unknown[];
}

const validDemo: DemoFixture = {
  version: 1,
  name: 'Valid Fixture Demo',
  nodes: [
    {
      id: 'play-1',
      type: 'playNode',
      position: { x: 0, y: 0 },
      data: {
        name: 'POST /trigger',
        kind: 'service',
        stateSource: { kind: 'request' },
        playAction: {
          kind: 'script',
          interpreter: 'bun',
          args: ['run'],
          scriptPath: 'scripts/play.ts',
        },
      },
    },
    {
      id: 'state-1',
      type: 'stateNode',
      position: { x: 200, y: 0 },
      data: {
        name: 'worker',
        kind: 'worker',
        stateSource: { kind: 'event' },
      },
    },
  ],
  connectors: [
    {
      id: 'c-1',
      source: 'play-1',
      target: 'state-1',
      kind: 'event',
      eventName: 'trigger.fired',
    },
  ],
};

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'seeflow-validate-schema-'));
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function writeFixture(name: string, body: unknown): Promise<string> {
  const path = join(tmpRoot, name);
  await writeFile(path, JSON.stringify(body, null, 2), 'utf8');
  return path;
}

describe('validateSchemaFile', () => {
  it('returns ok:true for a valid demo fixture', async () => {
    const path = await writeFixture('valid.json', validDemo);
    const result = await validateSchemaFile(path);
    expect(result.ok).toBe(true);
    expect(result.issues).toBeUndefined();
  });

  it('returns structured issues when a required field is missing', async () => {
    const { name: _omit, ...withoutName } = validDemo;
    const path = await writeFixture('missing-name.json', withoutName);

    const result = await validateSchemaFile(path);
    expect(result.ok).toBe(false);
    expect(result.issues).toBeDefined();
    const namedIssue = result.issues?.find((issue) => issue.path[0] === 'name');
    expect(namedIssue).toBeDefined();
    expect(namedIssue?.code).toBe('invalid_type');
  });

  it('returns issues for an unknown nodeType', async () => {
    const bad = {
      ...validDemo,
      nodes: [
        {
          id: 'bogus-1',
          type: 'martianNode',
          position: { x: 0, y: 0 },
          data: { name: 'nope' },
        },
      ],
      connectors: [],
    };
    const path = await writeFixture('unknown-type.json', bad);

    const result = await validateSchemaFile(path);
    expect(result.ok).toBe(false);
    expect(result.issues).toBeDefined();
    expect(result.issues?.length ?? 0).toBeGreaterThan(0);
    const typeIssue = result.issues?.find(
      (issue) => issue.path.includes('type') || issue.code === 'invalid_union_discriminator',
    );
    expect(typeIssue).toBeDefined();
  });

  it('reports a read error when the path does not exist', async () => {
    const result = await validateSchemaFile(join(tmpRoot, 'does-not-exist.json'));
    expect(result.ok).toBe(false);
    expect(result.issues?.[0]?.code).toBe('read_error');
  });

  it('reports an invalid_json error for malformed input', async () => {
    const path = join(tmpRoot, 'bad.json');
    await writeFile(path, '{ not json', 'utf8');
    const result = await validateSchemaFile(path);
    expect(result.ok).toBe(false);
    expect(result.issues?.[0]?.code).toBe('invalid_json');
  });
});

describe('validate-schema CLI', () => {
  const cliPath = join(import.meta.dir, 'validate-schema.ts');

  it('exits 0 and prints {"ok":true} on a valid demo', async () => {
    const path = await writeFixture('cli-valid.json', validDemo);
    const proc = Bun.spawn(['bun', cliPath, path], { stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true });
  });

  it('exits 1 and prints structured issues on an invalid demo', async () => {
    const { name: _omit, ...withoutName } = validDemo;
    const path = await writeFixture('cli-invalid.json', withoutName);
    const proc = Bun.spawn(['bun', cliPath, path], { stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.issues.length).toBeGreaterThan(0);
  });

  it('exits 1 with a usage message when called with no arguments', async () => {
    const proc = Bun.spawn(['bun', cliPath], { stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0].code).toBe('missing_argument');
  });
});
