#!/usr/bin/env bun
import { serve } from './server.ts';

const sub = process.argv[2];

if (!sub || sub === 'start') {
  const portArg = process.argv.find((a) => a.startsWith('--port='));
  const port = portArg ? Number(portArg.slice('--port='.length)) : 4321;
  if (!Number.isFinite(port) || port <= 0) {
    console.error(`Invalid --port: ${portArg}`);
    process.exit(1);
  }
  const server = serve({ port });
  console.log(`AnyDemo Studio listening on http://${server.hostname}:${server.port}`);
} else if (['register', 'unregister', 'list', 'stop'].includes(sub)) {
  console.log(`anydemo ${sub}: not implemented (M1.B)`);
  process.exit(0);
} else {
  console.error(`Unknown subcommand: ${sub}`);
  process.exit(1);
}
