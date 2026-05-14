/**
 * Process spawn abstraction. `runPlay` (US-003) and the StatusRunner (US-004)
 * depend on this interface so tests can drive them with an in-memory fake
 * instead of actually spawning child processes.
 *
 * The default implementation wraps `Bun.spawn`. Bun exposes stdin as a
 * `FileSink`; we wrap it in a standard `WritableStream<Uint8Array>` so
 * consumers can write a chunk and `close()` it through the same surface used
 * by tests with a fake spawner.
 */

export interface SpawnOptions {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: 'pipe' | 'ignore';
}

export interface SpawnHandle {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  /** Present iff `SpawnOptions.stdin === 'pipe'`. */
  stdin?: WritableStream<Uint8Array>;
  /** Resolves with the child's exit code (143 for SIGTERM, 137 for SIGKILL). */
  exited: Promise<number>;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export interface ProcessSpawner {
  spawn(opts: SpawnOptions): SpawnHandle;
}

export const defaultProcessSpawner: ProcessSpawner = {
  spawn(opts) {
    const child = Bun.spawn({
      cmd: opts.cmd,
      cwd: opts.cwd,
      env: opts.env,
      stdin: opts.stdin === 'pipe' ? 'pipe' : 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    let stdinStream: WritableStream<Uint8Array> | undefined;
    if (opts.stdin === 'pipe') {
      const sink = child.stdin;
      if (!sink) {
        throw new Error('Bun.spawn returned no stdin sink despite stdin: pipe');
      }
      stdinStream = new WritableStream<Uint8Array>({
        write(chunk) {
          sink.write(chunk);
        },
        async close() {
          await sink.end();
        },
        async abort() {
          await sink.end();
        },
      });
    }

    return {
      pid: child.pid,
      stdout: child.stdout as ReadableStream<Uint8Array>,
      stderr: child.stderr as ReadableStream<Uint8Array>,
      stdin: stdinStream,
      exited: child.exited,
      kill(signal) {
        child.kill(signal);
      },
    };
  },
};
