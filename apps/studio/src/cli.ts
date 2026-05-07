#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { DemoSchema } from './schema.ts';
import { serve } from './server.ts';

const DEFAULT_STUDIO_URL = 'http://localhost:4321';
const DEFAULT_DEMO_PATH = '.anydemo/demo.json';

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

if (!sub || sub === 'start') {
  const portArg = flagValue('port');
  const port = portArg ? Number(portArg) : 4321;
  if (!Number.isFinite(port) || port <= 0) {
    console.error(`Invalid --port: ${portArg}`);
    process.exit(1);
  }
  const server = serve({ port });
  console.log(`AnyDemo Studio listening on http://${server.hostname}:${server.port}`);
} else if (sub === 'register') {
  await runRegister();
} else if (['unregister', 'list', 'stop'].includes(sub)) {
  console.log(`anydemo ${sub}: not implemented (M1.B)`);
  process.exit(0);
} else {
  console.error(`Unknown subcommand: ${sub}`);
  process.exit(1);
}

async function runRegister() {
  const repoPath = resolve(flagValue('path') ?? '.');
  const demoPathArg = flagValue('demo') ?? DEFAULT_DEMO_PATH;
  const studioUrl = (process.env.ANYDEMO_STUDIO_URL ?? DEFAULT_STUDIO_URL).replace(/\/+$/, '');

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

  let res: Response;
  try {
    res = await fetch(`${studioUrl}/api/demos/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: parsed.data.name,
        repoPath,
        demoPath: demoPathArg,
      }),
    });
  } catch (err) {
    console.error(`Could not reach studio at ${studioUrl}: ${String(err)}`);
    console.error('Start it first: anydemo start');
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(`Studio returned ${res.status}: ${text}`);
    process.exit(1);
  }

  const { slug } = (await res.json()) as { id: string; slug: string };
  console.log(`Registered "${parsed.data.name}" → ${studioUrl}/d/${slug}`);
}
