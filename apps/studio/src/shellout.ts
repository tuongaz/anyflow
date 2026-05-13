/**
 * Fire-and-forget shellout used by the `/files/open` and `/files/reveal`
 * endpoints. The spawner is injectable so tests can verify the exact command
 * and arguments without actually launching $EDITOR or Finder.
 *
 * The default implementation uses `Bun.spawn` in detached fire-and-forget
 * mode: spawn-time failures (ENOENT, EACCES) throw synchronously from
 * `Bun.spawn` and we surface them as `{ ok: false, error }`. On success we
 * unref the child so the studio process doesn't wait for it to exit.
 */

export interface ShellRunResult {
  ok: boolean;
  error?: string;
}

export type Spawner = (cmd: string, args: string[]) => Promise<ShellRunResult>;

export const defaultSpawner: Spawner = async (cmd, args) => {
  try {
    const proc = Bun.spawn({
      cmd: [cmd, ...args],
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    proc.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};
