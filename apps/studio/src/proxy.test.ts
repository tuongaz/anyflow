import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type StudioEvent, createEventBus } from './events.ts';
import type { ProcessSpawner, SpawnHandle, SpawnOptions } from './process-spawner.ts';
import { runPlay } from './proxy.ts';

type Captured = { type: string; payload: Record<string, unknown> };
type CapturedStdin = { text: string; closed: boolean };

interface FakeOptions {
  stdout?: string;
  stderr?: string;
  /** Exit code if the script "exits naturally" (i.e. without being killed). */
  exitCode?: number;
  /** When set, exited never resolves on its own — only `kill()` resolves it. */
  neverExit?: boolean;
  /**
   * Signals on which `kill(signal)` resolves the exit promise. Use to model
   * a process that ignores SIGTERM but dies on SIGKILL.
   */
  killExitsOn?: Array<'SIGTERM' | 'SIGKILL'>;
}

interface FakeRecord {
  spawnCalls: SpawnOptions[];
  killCalls: Array<'SIGTERM' | 'SIGKILL'>;
  stdin: CapturedStdin;
}

function streamFromString(s: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (s.length > 0) controller.enqueue(new TextEncoder().encode(s));
      controller.close();
    },
  });
}

function captureStdin(): { stream: WritableStream<Uint8Array>; captured: CapturedStdin } {
  const captured: CapturedStdin = { text: '', closed: false };
  const decoder = new TextDecoder();
  const stream = new WritableStream<Uint8Array>({
    write(chunk) {
      captured.text += decoder.decode(chunk, { stream: true });
    },
    close() {
      captured.text += decoder.decode();
      captured.closed = true;
    },
    abort() {
      captured.closed = true;
    },
  });
  return { stream, captured };
}

function makeFakeSpawner(opts: FakeOptions): { spawner: ProcessSpawner; record: FakeRecord } {
  const exitsOn = new Set(opts.killExitsOn ?? ['SIGTERM', 'SIGKILL']);
  const record: FakeRecord = {
    spawnCalls: [],
    killCalls: [],
    stdin: { text: '', closed: false },
  };
  const spawner: ProcessSpawner = {
    spawn(spawnOpts) {
      record.spawnCalls.push(spawnOpts);
      let resolveExit: (code: number) => void = () => {};
      const exited = new Promise<number>((res) => {
        resolveExit = res;
      });
      let exitFn: () => void = () => {};

      if (!opts.neverExit) {
        // Resolve next tick so consumers can race against timeouts deterministically.
        exitFn = () => resolveExit(opts.exitCode ?? 0);
        queueMicrotask(exitFn);
      }

      let stdinStream: WritableStream<Uint8Array> | undefined;
      if (spawnOpts.stdin === 'pipe') {
        const cap = captureStdin();
        stdinStream = cap.stream;
        record.stdin = cap.captured;
      }

      const handle: SpawnHandle = {
        pid: 12345,
        stdout: streamFromString(opts.stdout ?? ''),
        stderr: streamFromString(opts.stderr ?? ''),
        stdin: stdinStream,
        exited,
        kill(signal) {
          record.killCalls.push(signal);
          if (exitsOn.has(signal)) {
            resolveExit(signal === 'SIGTERM' ? 143 : 137);
          }
        },
      };
      return handle;
    },
  };
  return { spawner, record };
}

const tmpDirs: string[] = [];

function makeProjectWithScript(scriptName = 'play.ts'): { cwd: string; scriptPath: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'anydemo-proxy-'));
  tmpDirs.push(cwd);
  mkdirSync(join(cwd, '.anydemo', 'scripts'), { recursive: true });
  writeFileSync(join(cwd, '.anydemo', 'scripts', scriptName), '// stub for tests');
  return { cwd, scriptPath: `scripts/${scriptName}` };
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function captureEvents(bus: ReturnType<typeof createEventBus>, demoId: string): Captured[] {
  const captured: Captured[] = [];
  bus.subscribe(demoId, (e: StudioEvent) =>
    captured.push({ type: e.type, payload: e.payload as Record<string, unknown> }),
  );
  return captured;
}

describe('runPlay (script spawner)', () => {
  it('returns parsed JSON body when stdout is valid JSON and exit is 0', async () => {
    const { cwd, scriptPath } = makeProjectWithScript();
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const { spawner } = makeFakeSpawner({ stdout: '{"ok":true,"n":42}\n' });

    const result = await runPlay({
      events: bus,
      demoId: 'demoA',
      nodeId: 'node1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, n: 42 });
    expect(result.error).toBeUndefined();
    expect(typeof result.runId).toBe('string');
    expect(captured.map((e) => e.type)).toEqual(['node:running', 'node:done']);
    const done = captured[1];
    expect(done?.payload).toMatchObject({
      nodeId: 'node1',
      status: 200,
      body: { ok: true, n: 42 },
    });
    expect(done?.payload.runId).toBe(result.runId);
  });

  it('returns raw string body when stdout is not valid JSON', async () => {
    const { cwd, scriptPath } = makeProjectWithScript();
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner } = makeFakeSpawner({ stdout: 'hello world (not json)\n' });

    const result = await runPlay({
      events: bus,
      demoId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe('hello world (not json)\n');
  });

  it('on exit code !== 0, surfaces the last non-empty stderr line as the error', async () => {
    const { cwd, scriptPath } = makeProjectWithScript();
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const stderr = 'warming up\n\nerror: ENOENT something\n';
    const { spawner } = makeFakeSpawner({ exitCode: 1, stderr });

    const result = await runPlay({
      events: bus,
      demoId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });

    expect(result.status).toBeUndefined();
    expect(result.error).toBe('error: ENOENT something');
    const types = captured.map((e) => e.type);
    expect(types).toEqual(['node:running', 'node:error']);
    expect(captured[1]?.payload).toMatchObject({
      nodeId: 'n1',
      message: 'error: ENOENT something',
    });
  });

  it('on timeout, escalates SIGTERM → SIGKILL and reports the timeout error', async () => {
    const { cwd, scriptPath } = makeProjectWithScript();
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    // Process ignores SIGTERM, only dies on SIGKILL.
    const { spawner, record } = makeFakeSpawner({
      neverExit: true,
      killExitsOn: ['SIGKILL'],
    });

    const result = await runPlay({
      events: bus,
      demoId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: {
        kind: 'script',
        interpreter: 'bun',
        scriptPath,
        timeoutMs: 50,
      },
      spawner,
    });

    expect(result.error).toBe('script timed out after 50ms');
    expect(record.killCalls).toEqual(['SIGTERM', 'SIGKILL']);
    const types = captured.map((e) => e.type);
    expect(types).toEqual(['node:running', 'node:error']);
    expect(captured[1]?.payload).toMatchObject({
      nodeId: 'n1',
      message: 'script timed out after 50ms',
    });
  }, 10_000);

  it('writes JSON.stringify(input) to stdin and closes it', async () => {
    const { cwd, scriptPath } = makeProjectWithScript();
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner, record } = makeFakeSpawner({ stdout: '{"ok":true}' });

    await runPlay({
      events: bus,
      demoId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: {
        kind: 'script',
        interpreter: 'bun',
        scriptPath,
        input: { hello: 'world', n: 1 },
      },
      spawner,
    });

    expect(record.spawnCalls[0]?.stdin).toBe('pipe');
    expect(record.stdin.text).toBe(JSON.stringify({ hello: 'world', n: 1 }));
    expect(record.stdin.closed).toBe(true);
  });

  it('spawns with stdin: ignore when action.input is undefined', async () => {
    const { cwd, scriptPath } = makeProjectWithScript();
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner, record } = makeFakeSpawner({ stdout: '{}' });

    await runPlay({
      events: bus,
      demoId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });

    expect(record.spawnCalls[0]?.stdin).toBe('ignore');
  });

  it('sets ANYDEMO_* env vars and assembles cmd as [interpreter, ...args, absScriptPath]', async () => {
    const { cwd, scriptPath } = makeProjectWithScript();
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner, record } = makeFakeSpawner({ stdout: '{}' });

    const result = await runPlay({
      events: bus,
      demoId: 'demoA',
      nodeId: 'node-x',
      cwd,
      action: {
        kind: 'script',
        interpreter: 'bun',
        args: ['run', '--silent'],
        scriptPath,
      },
      spawner,
    });

    const call = record.spawnCalls[0];
    if (!call) throw new Error('expected spawn to have been called');
    expect(call.cmd[0]).toBe('bun');
    expect(call.cmd[1]).toBe('run');
    expect(call.cmd[2]).toBe('--silent');
    expect(call.cmd[3]?.endsWith('/scripts/play.ts')).toBe(true);
    expect(call.cwd).toBe(cwd);
    expect(call.env.ANYDEMO_DEMO_ID).toBe('demoA');
    expect(call.env.ANYDEMO_NODE_ID).toBe('node-x');
    expect(call.env.ANYDEMO_RUN_ID).toBe(result.runId);
  });

  it('rejects a scriptPath that escapes the project root via a symlink', async () => {
    // Make two tmp dirs: the project and an outside dir containing the target.
    const cwd = mkdtempSync(join(tmpdir(), 'anydemo-proxy-'));
    tmpDirs.push(cwd);
    const outside = mkdtempSync(join(tmpdir(), 'anydemo-proxy-out-'));
    tmpDirs.push(outside);
    mkdirSync(join(cwd, '.anydemo'), { recursive: true });
    writeFileSync(join(outside, 'evil.ts'), '// outside');
    // .anydemo/escape.ts is a symlink pointing outside the project root.
    symlinkSync(join(outside, 'evil.ts'), join(cwd, '.anydemo', 'escape.ts'));

    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const { spawner, record } = makeFakeSpawner({ stdout: '{}' });

    const result = await runPlay({
      events: bus,
      demoId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath: 'escape.ts' },
      spawner,
    });

    expect(result.error).toBe('scriptPath escapes project root');
    expect(result.status).toBeUndefined();
    expect(record.spawnCalls).toHaveLength(0);
    const types = captured.map((e) => e.type);
    expect(types).toEqual(['node:error']);
    expect(captured[0]?.payload).toMatchObject({
      nodeId: 'n1',
      message: 'scriptPath escapes project root',
    });
  });
});
