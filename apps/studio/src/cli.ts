#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  clearPid,
  defaultPidPath,
  isPidAlive,
  readConfig,
  readPid,
  studioUrl,
  writeConfig,
  writePid,
} from './runtime.ts';
import { DemoSchema } from './schema.ts';
import { serve } from './server.ts';

const DEFAULT_DEMO_PATH = '.anydemo/demo.json';
const HEALTH_TIMEOUT_MS = 10_000;
const HEALTH_POLL_INTERVAL_MS = 150;

const argv = process.argv.slice(2);
const sub = argv[0];

const flagValue = (name: string): string | undefined => {
  const flag = `--${name}`;
  const eqArg = argv.find((a) => a.startsWith(`${flag}=`));
  if (eqArg) return eqArg.slice(`${flag}=`.length);
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  return undefined;
};

const hasFlag = (name: string): boolean => argv.includes(`--${name}`);

if (!sub || sub === 'start') {
  await runStart();
} else if (sub === 'stop') {
  runStop();
} else if (sub === 'register') {
  await runRegister();
} else if (['unregister', 'list'].includes(sub)) {
  console.log(`anydemo ${sub}: not implemented (M1.B)`);
  process.exit(0);
} else {
  console.error(`Unknown subcommand: ${sub}`);
  process.exit(1);
}

async function runStart() {
  const config = readConfig();
  const portArg = flagValue('port');
  const port = portArg ? Number(portArg) : config.port;
  if (!Number.isFinite(port) || port <= 0) {
    console.error(`Invalid --port: ${portArg}`);
    process.exit(1);
  }

  if (hasFlag('daemon')) {
    await spawnDaemon(port, config.host);
    return;
  }

  // persist the chosen address so other subcommands can find us
  writeConfig({ port, host: config.host });

  const server = serve({ port, hostname: config.host });
  writePid(process.pid);

  const cleanup = () => {
    if (readPid() === process.pid) clearPid();
  };
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('exit', cleanup);

  console.log(`AnyDemo Studio listening on http://${server.hostname}:${server.port}`);
}

async function spawnDaemon(port: number, host: string) {
  const url = `http://${host}:${port}`;
  if (await healthOk(url)) {
    console.log(`Studio already running at ${url}`);
    return;
  }

  const proc = spawnDetachedStudio(port);
  writePid(proc.pid);
  writeConfig({ port, host });

  if (!(await waitForHealth(url, HEALTH_TIMEOUT_MS))) {
    console.error(`Timed out waiting for studio at ${url}/health`);
    process.exit(1);
  }
  console.log(`AnyDemo Studio started in background on ${url} (pid ${proc.pid})`);
}

function spawnDetachedStudio(port: number): { pid: number } {
  const proc = Bun.spawn({
    cmd: [process.execPath, import.meta.path, 'start', `--port=${port}`],
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, ANYDEMO_DAEMON: '1' },
  });
  proc.unref();
  return { pid: proc.pid };
}

function runStop() {
  const pid = readPid();
  if (!pid) {
    console.log(`No studio running (no pid file at ${defaultPidPath()}).`);
    return;
  }
  if (!isPidAlive(pid)) {
    console.log(`Stale pid file (pid ${pid} not running); cleaning up.`);
    clearPid();
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Sent SIGTERM to studio (pid ${pid}).`);
  } catch (err) {
    console.error(`Failed to stop pid ${pid}: ${String(err)}`);
    process.exit(1);
  }
}

async function runRegister() {
  const repoPath = resolve(flagValue('path') ?? '.');
  const demoPathArg = flagValue('demo') ?? DEFAULT_DEMO_PATH;
  const noStart = hasFlag('no-start');
  const config = readConfig();
  const overrideUrl = process.env.ANYDEMO_STUDIO_URL?.replace(/\/+$/, '');
  const url = overrideUrl ?? studioUrl(config);

  const fullPath = isAbsolute(demoPathArg) ? demoPathArg : join(repoPath, demoPathArg);
  if (!existsSync(fullPath)) {
    console.error(`No demo file at ${fullPath}`);
    console.error(`Create ${DEFAULT_DEMO_PATH} in your repo, or pass --demo <path>.`);
    process.exit(1);
  }

  let demo: unknown;
  try {
    demo = await Bun.file(fullPath).json();
  } catch (err) {
    console.error(`Failed to parse ${fullPath}: ${String(err)}`);
    process.exit(1);
  }

  const parsed = DemoSchema.safeParse(demo);
  if (!parsed.success) {
    console.error(`${fullPath} failed schema validation:`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.') || '<root>'}: ${issue.message}`);
    }
    process.exit(1);
  }

  await ensureStudioRunning(url, config.port, noStart);

  let res: Response;
  try {
    res = await fetch(`${url}/api/demos/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: parsed.data.name,
        repoPath,
        demoPath: demoPathArg,
      }),
    });
  } catch (err) {
    console.error(`Could not reach studio at ${url}: ${String(err)}`);
    console.error('Start it first: anydemo start');
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(`Studio returned ${res.status}: ${text}`);
    process.exit(1);
  }

  const body = (await res.json()) as {
    id: string;
    slug: string;
    sdk?: { outcome: 'written' | 'present' | 'skipped'; filePath: string | null };
  };
  console.log(`Registered "${parsed.data.name}" → ${url}/d/${body.slug}`);

  if (body.sdk?.outcome === 'written') {
    console.log(`Wrote ${body.sdk.filePath} (event-bound state node detected)`);
  } else if (body.sdk?.outcome === 'present') {
    console.log(`SDK helper already present at ${body.sdk.filePath} (skipped)`);
  }
}

async function ensureStudioRunning(url: string, port: number, noStart: boolean) {
  if (await healthOk(url)) return;

  // Health failed — maybe the recorded pid is alive and still booting.
  const pid = readPid();
  if (pid && isPidAlive(pid) && (await waitForHealth(url, HEALTH_TIMEOUT_MS))) return;

  if (noStart) {
    console.error(`Studio is not running at ${url}.`);
    console.error('Start it first: anydemo start');
    process.exit(1);
  }

  console.log(`Studio not running at ${url}; starting in background...`);
  const proc = spawnDetachedStudio(port);
  writePid(proc.pid);

  if (!(await waitForHealth(url, HEALTH_TIMEOUT_MS))) {
    console.error(`Studio did not respond at ${url}/health within ${HEALTH_TIMEOUT_MS}ms`);
    process.exit(1);
  }
  console.log(`Studio started (pid ${proc.pid}).`);
}

async function healthOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthOk(url)) return true;
    await Bun.sleep(HEALTH_POLL_INTERVAL_MS);
  }
  return false;
}
