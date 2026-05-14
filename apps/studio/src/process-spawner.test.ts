import { describe, expect, it } from 'bun:test';
import { defaultProcessSpawner } from './process-spawner.ts';

function envFromProcess(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  return { ...env, ...extra };
}

describe('defaultProcessSpawner', () => {
  it('echoes stdout from a simple command', async () => {
    const handle = defaultProcessSpawner.spawn({
      cmd: ['echo', 'hello'],
      cwd: process.cwd(),
      env: envFromProcess(),
      stdin: 'ignore',
    });

    expect(handle.pid).toBeGreaterThan(0);
    expect(handle.stdin).toBeUndefined();

    const text = await new Response(handle.stdout).text();
    const code = await handle.exited;

    expect(text.trim()).toBe('hello');
    expect(code).toBe(0);
  });

  it('propagates env vars to the child', async () => {
    const handle = defaultProcessSpawner.spawn({
      cmd: ['bun', '-e', 'process.stdout.write(process.env.ANYDEMO_TEST_VAR ?? "missing")'],
      cwd: process.cwd(),
      env: envFromProcess({ ANYDEMO_TEST_VAR: 'spawner-says-hi' }),
      stdin: 'ignore',
    });

    const text = await new Response(handle.stdout).text();
    const code = await handle.exited;

    expect(text).toBe('spawner-says-hi');
    expect(code).toBe(0);
  });

  it("pipes JSON to the child's stdin and reads it back via stdout", async () => {
    const handle = defaultProcessSpawner.spawn({
      cmd: ['bun', '-e', 'process.stdout.write(await Bun.stdin.text())'],
      cwd: process.cwd(),
      env: envFromProcess(),
      stdin: 'pipe',
    });

    const { stdin } = handle;
    if (!stdin) throw new Error('expected stdin to be defined');

    const payload = { hello: 'world', n: 42 };
    const writer = stdin.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify(payload)));
    await writer.close();

    const text = await new Response(handle.stdout).text();
    const code = await handle.exited;

    expect(JSON.parse(text)).toEqual(payload);
    expect(code).toBe(0);
  });

  it('kill(SIGTERM) causes exited to resolve with non-zero code', async () => {
    const handle = defaultProcessSpawner.spawn({
      cmd: ['sleep', '30'],
      cwd: process.cwd(),
      env: envFromProcess(),
      stdin: 'ignore',
    });

    handle.kill('SIGTERM');
    const code = await handle.exited;

    expect(code).not.toBe(0);
  });
});
